'use strict';

(() => {
  const documentFile = 'capture-offscreen.html';
  const documentUrl = chrome.runtime.getURL(documentFile);
  const incognito = chrome.extension?.inIncognitoContext === true;
  // Chrome's session storage is shared between regular and split-incognito workers.
  const prefix = incognito ? 'capture:private:' : 'capture:regular:';
  const stateKey = tabId => prefix + tabId;
  const listeners = new Set();
  let operations = Promise.resolve();

  function enqueue(operation) {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  }

  const idle = tabId => ({ success: true, state: 'idle', tabId, fullscreenSync: null });

  function requireTabId(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('No target tab.');
  }

  async function getState(tabId) {
    return (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)];
  }

  function saveState(tabId, state) {
    return chrome.storage.session.set({ [stateKey(tabId)]: state });
  }

  async function allStates() {
    return Object.entries(await chrome.storage.session.get(null))
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, state]) => [Number(key.slice(prefix.length)), state]);
  }

  async function hasDocument() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [documentUrl], incognito
    });
    return contexts.length > 0;
  }

  async function ensureDocument() {
    if (await hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: documentFile,
      reasons: ['USER_MEDIA'],
      justification: 'Process the selected tab’s audio locally while the Sound Adjuster popup is closed.'
    });
  }

  async function closeIdleDocument() {
    if ((await allStates()).length === 0 && await hasDocument()) {
      await chrome.offscreen.closeDocument();
    }
  }

  async function audioRequest(action, tabId, state, payload = {}) {
    const result = await chrome.runtime.sendMessage({
      target: 'sound-adjuster-capture-offscreen', action, tabId, sessionId: state.sessionId, ...payload
    });
    if (result?.success !== true) throw new Error(result?.error || 'The tab audio processor did not respond.');
    return result;
  }

  async function captureInfo(tabId) {
    return (await chrome.tabCapture.getCapturedTabs()).find(info => info.tabId === tabId);
  }

  async function isActive(tabId) {
    requireTabId(tabId);
    if (!await getState(tabId)) return false;
    return (await captureInfo(tabId))?.status === 'active';
  }

  function resultWithWindow(audio, state) {
    const { sessionId, ...fullscreenSync } = state;
    const { sessionId: audioSessionId, ...publicAudio } = audio;
    return { ...publicAudio, fullscreenSync };
  }

  async function restoreWindow(tabId, state) {
    if (!state.ownsWindow) return;
    const window = await chrome.windows.get(state.windowId).catch(() => null);
    if (window?.state === 'fullscreen') {
      await chrome.windows.update(window.id, { state: state.restoreState });
    }
    state.ownsWindow = false;
    await saveState(tabId, state);
  }

  async function syncFullscreen(info) {
    if (info?.status !== 'active') return;
    const { tabId } = info;
    const state = await getState(tabId);
    if (!state) return;
    state.playerFullscreen = info.fullscreen === true;
    if (!state.playerFullscreen) {
      state.suppressed = false;
      await restoreWindow(tabId, state);
      await saveState(tabId, state);
      return;
    }
    await saveState(tabId, state);
    if (state.suppressed) return;

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.active) return;
    const window = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!window || window.state === 'fullscreen') return;

    state.windowId = tab.windowId;
    state.restoreState = window.state === 'maximized' ? 'maximized' : 'normal';
    // Persist ownership before the browser transition so a restarted worker can release it.
    state.ownsWindow = true;
    delete state.error;
    await saveState(tabId, state);
    try {
      await chrome.windows.update(window.id, { state: 'fullscreen' });
    } catch (error) {
      state.ownsWindow = false;
      state.error = error.message;
      await saveState(tabId, state);
    }
  }

  function notifyStopped(tabId, reason) {
    const callbacks = new Set(listeners);
    if (typeof globalThis.onSoundAdjusterCaptureStopped === 'function') {
      callbacks.add(globalThis.onSoundAdjusterCaptureStopped);
    }
    for (const listener of callbacks) {
      // Listeners can call this API again, so do not wait for them in the queue.
      Promise.resolve().then(() => listener(tabId, reason)).catch(console.warn);
    }
  }

  async function stopSession(tabId, reason, expectedSessionId) {
    const state = await getState(tabId);
    if (!state || expectedSessionId && state.sessionId !== expectedSessionId) return idle(tabId);

    // Release the native stream even if browser window restoration later fails.
    if (await hasDocument()) {
      await audioRequest('stop', tabId, state).catch(async error => {
        if (await hasDocument()) throw error;
      });
    }
    try {
      await restoreWindow(tabId, state);
    } catch (error) {
      console.warn('Unable to restore the Sound Adjuster fullscreen window:', error);
    }
    await chrome.storage.session.remove(stateKey(tabId));
    await closeIdleDocument().catch(console.warn);
    if (reason) notifyStopped(tabId, reason);
    return idle(tabId);
  }

  async function readStatus(tabId, action, payload) {
    const state = await getState(tabId);
    if (!state) return idle(tabId);
    if (await hasDocument()) {
      const audio = await audioRequest(action, tabId, state, payload);
      if (audio.state === 'running' && audio.sessionId === state.sessionId) {
        return resultWithWindow(audio, state);
      }
    }
    return stopSession(tabId, 'stream-ended', state.sessionId);
  }

  async function startSession(tabId, settings) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.incognito !== incognito || tab.pendingUrl || !/^https?:/.test(tab.url || '')) {
      throw new Error('Open Sound Adjuster on the active website tab before starting tab audio.');
    }
    const current = await readStatus(tabId, 'status');
    if (current.state === 'running') return current;
    const state = {
      sessionId: crypto.randomUUID(), windowId: tab.windowId,
      playerFullscreen: false, ownsWindow: false, suppressed: false
    };
    await saveState(tabId, state);
    try {
      await ensureDocument();
      const fresh = await chrome.tabs.get(tabId);
      if (!fresh.active || fresh.pendingUrl || fresh.url !== tab.url) throw new Error('The selected tab changed.');
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const audio = await audioRequest('start', tabId, state, { settings, streamId });
      if (audio.state !== 'running' || audio.sessionId !== state.sessionId) throw new Error('Tab audio did not start.');
      const latest = await chrome.tabs.get(tabId);
      if (latest.pendingUrl || latest.url !== tab.url) throw new Error('The selected tab changed.');
      await syncFullscreen(await captureInfo(tabId));
      return resultWithWindow(audio, await getState(tabId) || state);
    } catch (error) {
      await stopSession(tabId, undefined, state.sessionId).catch(console.warn);
      throw error;
    }
  }

  function withTab(tabId, operation) {
    requireTabId(tabId);
    return enqueue(operation);
  }

  globalThis.SoundAdjusterCapture = Object.freeze({
    isActive,
    start: async (tabId, settings) => withTab(tabId, () => startSession(tabId, settings)),
    stop: async tabId => withTab(tabId, () => stopSession(tabId)),
    status: async tabId => withTab(tabId, () => readStatus(tabId, 'status')),
    apply: async (tabId, settings) => withTab(tabId, () => readStatus(tabId, 'apply', { settings })),
    stopAll: () => enqueue(async () => {
      const results = [];
      for (const [tabId] of await allStates()) {
        try {
          results.push(await stopSession(tabId));
        } catch (error) {
          results.push({ success: false, tabId, error: error.message });
        }
      }
      if (results.some(result => !result.success)) {
        throw new Error('Unable to stop tab audio in every tab.');
      }
      return { success: true, state: 'idle', tabs: results.map(result => result.tabId) };
    }),
    onStopped(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'sound-adjuster-capture-worker' || message.action !== 'ended'
      || sender.id !== chrome.runtime.id || sender.tab || sender.url !== documentUrl
      || !Number.isInteger(message.tabId) || typeof message.sessionId !== 'string') return false;
    enqueue(() => stopSession(message.tabId, 'track-ended', message.sessionId))
      .then(reply, error => reply({ success: false, error: error.message }));
    return true;
  });

  chrome.tabCapture.onStatusChanged.addListener(info => {
    enqueue(async () => {
      if (info.status === 'active') return syncFullscreen(info);
      if (info.status !== 'stopped' && info.status !== 'error') return;
      const current = await captureInfo(info.tabId);
      if (current?.status === 'active' || current?.status === 'pending') return;
      await stopSession(info.tabId, info.status === 'error' ? 'capture-error' : 'capture-stopped');
    }).catch(console.warn);
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    enqueue(() => stopSession(tabId)).catch(console.warn);
  });

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    enqueue(async () => {
      for (const [otherId, state] of await allStates()) {
        if (otherId !== tabId && state.windowId === windowId) await restoreWindow(otherId, state);
      }
      if (await getState(tabId)) await syncFullscreen(await captureInfo(tabId));
    }).catch(console.warn);
  });

  chrome.tabs.onDetached.addListener(tabId => {
    enqueue(async () => {
      const state = await getState(tabId);
      if (state) await restoreWindow(tabId, state);
    }).catch(console.warn);
  });

  chrome.tabs.onAttached.addListener(tabId => {
    enqueue(async () => {
      if (await getState(tabId)) await syncFullscreen(await captureInfo(tabId));
    }).catch(console.warn);
  });

  chrome.windows.onBoundsChanged.addListener(window => {
    enqueue(async () => {
      const owners = (await allStates()).filter(([, state]) => state.windowId === window.id && state.ownsWindow);
      if (!owners.length) return;
      // The event can describe an old transition. Read the window before treating it as user exit.
      const current = await chrome.windows.get(window.id).catch(() => null);
      if (!current || current.state === 'fullscreen') return;
      for (const [tabId, state] of owners) {
        state.ownsWindow = false;
        state.suppressed = true;
        await saveState(tabId, state);
      }
    }).catch(console.warn);
  });
})();
