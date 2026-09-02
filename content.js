'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  gain: 1,
  pan: 0,
  mono: false,
  flip: false,
  eqBass: 0,
  eqLowMid: 0,
  eqMid: 0,
  eqHighMid: 0,
  eqTreble: 0
});
const NEUTRAL_SETTINGS = DEFAULT_SETTINGS;
const BASIC_MODE_HOSTS = ['tiktok.com'];
const registeredMediaElements = new WeakSet();
let frameSettings = { ...DEFAULT_SETTINGS };
let hasUserSettings = false;
let frameDisabled = false;
let initializationPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mergeSettings(baseSettings, updates) {
  const merged = { ...DEFAULT_SETTINGS, ...baseSettings };
  const ranges = {
    gain: [0, 5],
    pan: [-1, 1],
    eqBass: [-20, 20],
    eqLowMid: [-20, 20],
    eqMid: [-20, 20],
    eqHighMid: [-20, 20],
    eqTreble: [-20, 20]
  };

  for (const [key, range] of Object.entries(ranges)) {
    if (!(key in updates)) continue;
    const value = Number.parseFloat(updates[key]);
    if (Number.isFinite(value)) merged[key] = clamp(value, range[0], range[1]);
  }

  if ('mono' in updates) merged.mono = Boolean(updates.mono);
  if ('flip' in updates) merged.flip = Boolean(updates.flip);
  return merged;
}

function isBasicModeHost(hostname) {
  return BASIC_MODE_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
}

function getMediaCapability(el) {
	if (frameDisabled) {
		return { mode: 'disabled', reason: 'site-exception' };
	}

  if (el.xSoundFixerMode === 'passthrough') {
    return { mode: 'unsupported', reason: 'audio-graph-failed' };
  }

  if (el.xSoundFixerContext && el.xSoundFixerGain) {
    return { mode: 'full', reason: null };
  }

  if (isBasicModeHost(window.location.hostname)) {
    return { mode: 'basic', reason: 'site-restricted' };
  }

  if (el.mediaKeys) {
    return { mode: 'basic', reason: 'protected-media' };
  }

  const source = el.currentSrc || el.src;
  if (!source) {
    return { mode: 'pending', reason: 'media-not-ready' };
  }

  try {
    const sourceUrl = new URL(source, window.location.href);
    const isHttpMedia = sourceUrl.protocol === 'http:' || sourceUrl.protocol === 'https:';
    const isCrossOrigin = isHttpMedia && sourceUrl.origin !== window.location.origin;

    if (isCrossOrigin && el.crossOrigin === null) {
      return { mode: 'basic', reason: 'cross-origin-media' };
    }
  } catch (error) {
    console.warn('Unable to inspect media source URL:', source, error);
    return { mode: 'basic', reason: 'unknown-media-source' };
  }

  return { mode: 'full', reason: null };
}

function initializeAudioGraph(el, elid) {
  if (el.xSoundFixerContext && el.xSoundFixerGain) {
    return { success: true, capability: { mode: 'full', reason: null } };
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    el.xSoundFixerMode = 'basic';
    return {
      success: false,
      capability: { mode: 'basic', reason: 'web-audio-unavailable' }
    };
  }

  let context;
  let source;

  try {
    context = new AudioContextClass();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);

    const eqBass = context.createBiquadFilter();
    eqBass.type = 'lowshelf';
    eqBass.frequency.value = 250;

    const eqLowMid = context.createBiquadFilter();
    eqLowMid.type = 'peaking';
    eqLowMid.frequency.value = 500;
    eqLowMid.Q.value = 1;

    const eqMid = context.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 2000;
    eqMid.Q.value = 1;

    const eqHighMid = context.createBiquadFilter();
    eqHighMid.type = 'peaking';
    eqHighMid.frequency.value = 6000;
    eqHighMid.Q.value = 1;

    const eqTreble = context.createBiquadFilter();
    eqTreble.type = 'highshelf';
    eqTreble.frequency.value = 8000;

    // Create the source last so failures before this point cannot reroute audio.
    source = context.createMediaElementSource(el);
    source.connect(eqBass);
    eqBass.connect(eqLowMid);
    eqLowMid.connect(eqMid);
    eqMid.connect(eqHighMid);
    eqHighMid.connect(eqTreble);
    eqTreble.connect(gain);
    gain.connect(pan);
    pan.connect(context.destination);

    el.xSoundFixerContext = context;
    el.xSoundFixerSource = source;
    el.xSoundFixerGain = gain;
    el.xSoundFixerPan = pan;
    el.xSoundFixerSplit = split;
    el.xSoundFixerMerge = merge;
    el.xSoundFixerEqBass = eqBass;
    el.xSoundFixerEqLowMid = eqLowMid;
    el.xSoundFixerEqMid = eqMid;
    el.xSoundFixerEqHighMid = eqHighMid;
    el.xSoundFixerEqTreble = eqTreble;
    el.xSoundFixerOriginalChannels = context.destination.channelCount;
    el.xSoundFixerMode = 'full';

    return { success: true, capability: { mode: 'full', reason: null } };
  } catch (error) {
    console.warn(`Failed to create the audio graph for ${elid}:`, error);

    if (source && context) {
      try {
        source.disconnect();
        source.connect(context.destination);
        el.xSoundFixerContext = context;
        el.xSoundFixerSource = source;
        el.xSoundFixerMode = 'passthrough';
      } catch (passthroughError) {
        console.warn('Failed to restore direct media playback:', passthroughError);
      }

      return {
        success: false,
        capability: { mode: 'unsupported', reason: 'audio-graph-failed' }
      };
    }

    if (context && context.state !== 'closed') {
      context.close().catch(() => {});
    }

    el.xSoundFixerMode = 'basic';
    return {
      success: false,
      capability: { mode: 'basic', reason: 'web-audio-unavailable' }
    };
  }
}

function setChannelMode(el, settings) {
  if (!el.xSoundFixerContext || !el.xSoundFixerPan) return;

  try {
    el.xSoundFixerContext.destination.channelCount = settings.mono
      ? 1
      : el.xSoundFixerOriginalChannels;
  } catch (error) {
    console.warn('Unable to change destination channel count:', error);
  }

  if (el.xSoundFixerFlipped === settings.flip) return;

  try {
    el.xSoundFixerPan.disconnect();
    el.xSoundFixerSplit.disconnect();
    el.xSoundFixerMerge.disconnect();

    if (settings.flip) {
      el.xSoundFixerPan.connect(el.xSoundFixerSplit);
      el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 0, 1);
      el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 1, 0);
      el.xSoundFixerMerge.connect(el.xSoundFixerContext.destination);
    } else {
      el.xSoundFixerPan.connect(el.xSoundFixerContext.destination);
    }

    el.xSoundFixerFlipped = settings.flip;
  } catch (error) {
    console.warn('Unable to update channel routing:', error);
  }
}

function resumeAudioContext(el) {
  const context = el?.xSoundFixerContext;
  if (!context || context.state !== 'suspended') return false;

  try {
    const resumeResult = context.resume();
    if (resumeResult && typeof resumeResult.catch === 'function') {
      resumeResult.catch(() => {});
    }
    return true;
  } catch (error) {
    return false;
  }
}

function applySettingsToAudioGraph(el, settings) {
  el.xSoundFixerGain.gain.value = settings.gain;
  el.xSoundFixerPan.pan.value = settings.pan;
  el.xSoundFixerEqBass.gain.value = settings.eqBass;
  el.xSoundFixerEqLowMid.gain.value = settings.eqLowMid;
  el.xSoundFixerEqMid.gain.value = settings.eqMid;
  el.xSoundFixerEqHighMid.gain.value = settings.eqHighMid;
  el.xSoundFixerEqTreble.gain.value = settings.eqTreble;
  setChannelMode(el, settings);
}

function applyFullSettings(el, elid, updates) {
  const graphResult = initializeAudioGraph(el, elid);
  if (!graphResult.success) {
    return { ...graphResult, applied: false };
  }

  const settings = mergeSettings(el.xSoundFixerSettings, updates);

  resumeAudioContext(el);

  el.xSoundFixerSettings = settings;
  applySettingsToAudioGraph(el, settings);
  return {
    success: true,
    applied: true,
    settings: { ...settings },
    capability: { mode: 'full', reason: null }
  };
}

function applySettingsToElement(el, updates) {
  const elid = el.getAttribute('data-x-soundfixer-id');
  const capability = getMediaCapability(el);

	if (capability.mode === 'disabled') {
		el.xSoundFixerDisabled = true;
		el.xSoundFixerSettings = mergeSettings(el.xSoundFixerSettings || frameSettings, updates);
		return {
			success: true,
			applied: false,
			settings: { ...el.xSoundFixerSettings },
			capability
		};
	}

  if (capability.mode === 'pending') {
    el.xSoundFixerPendingSettings = mergeSettings(el.xSoundFixerPendingSettings, updates);
    return { success: true, applied: false, capability };
  }

  if (capability.mode !== 'full') {
    el.xSoundFixerMode = capability.mode === 'unsupported' ? 'passthrough' : 'basic';
    el.xSoundFixerSettings = {
      ...DEFAULT_SETTINGS,
      gain: Number.isFinite(el.volume) ? el.volume : 1
    };
    return {
      success: true,
      applied: false,
      settings: { ...el.xSoundFixerSettings },
      capability
    };
  }

  const pendingSettings = el.xSoundFixerPendingSettings || {};
  delete el.xSoundFixerPendingSettings;
  return applyFullSettings(el, elid, { ...pendingSettings, ...updates });
}

function applySettings(elid, updates, rememberForFrame = true) {
  const el = document.querySelector(`[data-x-soundfixer-id="${elid}"]`);
  if (!el) {
    return {
      success: false,
      applied: false,
      error: `Media element ${elid} was not found`,
      capability: { mode: 'unsupported', reason: 'media-removed' }
    };
  }

  if (rememberForFrame) {
    frameSettings = mergeSettings(frameSettings, updates);
    hasUserSettings = true;
  }

  return applySettingsToElement(el, updates);
}

function setElementSiteDisabled(el, disabled) {
	el.xSoundFixerDisabled = disabled === true;
	const desiredSettings = el.xSoundFixerSettings || { ...frameSettings };

	if (el.xSoundFixerContext && el.xSoundFixerGain) {
		applySettingsToAudioGraph(el, el.xSoundFixerDisabled ? NEUTRAL_SETTINGS : desiredSettings);
	} else if (!el.xSoundFixerDisabled) {
		return applySettingsToElement(el, desiredSettings);
	}

	return {
		success: true,
		applied: Boolean(el.xSoundFixerContext && el.xSoundFixerGain),
		settings: { ...desiredSettings },
		capability: getMediaCapability(el)
	};
}

function setSiteDisabled(disabled) {
	frameDisabled = disabled === true;
	const media = [];
	for (const el of document.querySelectorAll('video, audio')) {
		registerMediaElement(el);
		media.push(setElementSiteDisabled(el, frameDisabled));
	}
	return { success: true, disabled: frameDisabled, media };
}

function assignMediaId(el) {
  if (!el.hasAttribute('data-x-soundfixer-id')) {
    el.setAttribute('data-x-soundfixer-id', Math.random().toString(36).slice(2, 12));
  }
  return el.getAttribute('data-x-soundfixer-id');
}

function scheduleSettingsRestore(el) {
  if (!hasUserSettings) return;
  clearTimeout(el.xSoundFixerRestoreTimer);
  el.xSoundFixerRestoreTimer = setTimeout(() => {
    assignMediaId(el);
    applySettingsToElement(el, frameSettings);
  }, 0);
}

function registerMediaElement(el) {
  assignMediaId(el);
	el.xSoundFixerDisabled = frameDisabled;
  if (registeredMediaElements.has(el)) return;
  registeredMediaElements.add(el);

  el.addEventListener('loadstart', () => scheduleSettingsRestore(el));
  el.addEventListener('loadedmetadata', () => scheduleSettingsRestore(el));
  el.addEventListener('play', () => {
    resumeAudioContext(el);
    scheduleSettingsRestore(el);
  });
  el.addEventListener('playing', () => resumeAudioContext(el));
  el.addEventListener('volumechange', () => resumeAudioContext(el));

  if (hasUserSettings && !frameDisabled) {
    applySettingsToElement(el, frameSettings);
  }
}

function getMediaState(el) {
  const capability = getMediaCapability(el);
  const settings = el.xSoundFixerSettings || {
    ...DEFAULT_SETTINGS,
    gain: capability.mode === 'basic' && Number.isFinite(el.volume) ? el.volume : 1
  };

  return {
    type: el.tagName.toLowerCase(),
    isPlaying: el.currentTime > 0 && !el.paused && !el.ended && el.readyState > 2,
    settings: { ...settings },
    capability,
		siteDisabled: frameDisabled
  };
}

function scanMediaElements() {
  const result = new Map();

  for (const el of document.querySelectorAll('video, audio')) {
    registerMediaElement(el);
    result.set(assignMediaId(el), getMediaState(el));
  }

  return result;
}

async function loadRememberedSiteProfile() {
  try {
    const result = await browser.runtime.sendMessage({ action: 'getSiteProfile' });
    if (result?.remembered && result.profile?.settings) {
      frameSettings = mergeSettings(DEFAULT_SETTINGS, result.profile.settings);
      hasUserSettings = true;
    }
  } catch (error) {
    console.warn('Unable to load the remembered site profile:', error);
  }
}

async function loadSiteExceptionStatus() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'getSiteExceptionStatus' });
		frameDisabled = result?.disabled === true;
	} catch (error) {
		console.warn('Unable to load the site exception status:', error);
		frameDisabled = false;
	}
}

async function handleMessage(message) {
  try {
    if (initializationPromise) await initializationPromise;

    switch (message.action) {
      case 'scanMedia': {
        const mediaMap = scanMediaElements();
        return {
          success: true,
          media: Object.fromEntries(mediaMap)
        };
      }

      case 'applySettings':
        return applySettings(message.elid, message.settings);

		case 'setSiteDisabled':
			return setSiteDisabled(message.disabled);

      case 'getStatus': {
        const mediaMap = scanMediaElements();
        return {
          success: true,
          status: {
            connectedMediaCount: mediaMap.size,
            media: Object.fromEntries(mediaMap)
          }
        };
      }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  } catch (error) {
    console.error('Error handling Sound Adjuster message:', error);
    return { success: false, error: error.message };
  }
}

function registerMediaFromNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

  let mediaChanged = false;

  if (node.matches && node.matches('video, audio')) {
    registerMediaElement(node);
    mediaChanged = true;
  }

  if (node.matches && node.matches('source')) {
    const parentMedia = node.closest('video, audio');
    if (parentMedia) {
      scheduleSettingsRestore(parentMedia);
      mediaChanged = true;
    }
  }

  if (node.querySelectorAll) {
    const nestedMedia = node.querySelectorAll('video, audio');
    nestedMedia.forEach(registerMediaElement);
    mediaChanged = mediaChanged || nestedMedia.length > 0;
  }

  if (mediaChanged) {
    browser.runtime.sendMessage({ action: 'mediaElementsChanged' }).catch(() => {
      // The popup is usually closed; no listener is a normal condition.
    });
  }
}

async function initialize() {
	await Promise.all([
		loadRememberedSiteProfile(),
		loadSiteExceptionStatus()
	]);
  scanMediaElements();

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(registerMediaFromNode);
      }

      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.matches && target.matches('video, audio')) {
          scheduleSettingsRestore(target);
        } else if (target.matches && target.matches('source')) {
          const parentMedia = target.closest('video, audio');
          if (parentMedia) scheduleSettingsRestore(parentMedia);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  });

  window.soundAdjusterObserver = observer;
}

browser.runtime.onMessage.addListener(handleMessage);

if (document.readyState === 'loading') {
  initializationPromise = new Promise(resolve => {
    document.addEventListener('DOMContentLoaded', () => {
      initialize().finally(resolve);
    }, { once: true });
  });
} else {
  initializationPromise = initialize();
}
