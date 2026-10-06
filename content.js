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
const mediaIds = new WeakMap();
const activeMediaElements = new Map();
const MAX_ACTIVE_AUDIO_GRAPHS = 32;
const MAX_FRAME_AUDIO_SOURCES = 64;
const MAX_TRACKED_MEDIA_ELEMENTS = 128;
const PROCESSING_NODE_KEYS = ['Gain', 'Analyser', 'Pan', 'Split', 'Merge', 'Output',
  'EqBass', 'EqLowMid', 'EqMid', 'EqHighMid', 'EqTreble'];
let nextMediaId = 0;
let sharedAudioContext = null;
let frameAudioSourceCount = 0;
let activeAudioGraphCount = 0;
let mediaChangeTimer = null;
let frameSettings = { ...DEFAULT_SETTINGS };
let hasUserSettings = false;
let frameDisabled = true;
let siteExceptionKnown = false;
let initializationPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mergeSettings(baseSettings, updates) {
  const merged = { ...DEFAULT_SETTINGS, ...baseSettings };
  delete merged.extraBoost;
  delete merged.limiter;
  const ranges = {
    pan: [-1, 1],
    eqBass: [-20, 20],
    eqLowMid: [-20, 20],
    eqMid: [-20, 20],
    eqHighMid: [-20, 20],
    eqTreble: [-20, 20]
  };

  const gain = Number.parseFloat('gain' in updates ? updates.gain : merged.gain);
  merged.gain = Number.isFinite(gain) ? clamp(gain, 0, 5) : DEFAULT_SETTINGS.gain;

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
		return { mode: 'disabled', reason: siteExceptionKnown ? 'site-exception' : 'site-exception-unavailable' };
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

  if (activeAudioGraphCount >= MAX_ACTIVE_AUDIO_GRAPHS ||
      (!el.xSoundFixerSource && frameAudioSourceCount >= MAX_FRAME_AUDIO_SOURCES)) {
    return { mode: 'basic', reason: 'audio-resource-limit' };
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
  let source = el.xSoundFixerSource;
  const createdNodes = [];

  try {
    context = sharedAudioContext || (sharedAudioContext = new AudioContextClass());
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    const pan = context.createStereoPanner();
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const output = context.createGain();
    output.channelCountMode = 'explicit';
    output.channelInterpretation = 'speakers';
    output.channelCount = 2;

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
    createdNodes.push(gain, analyser, pan, split, merge, output,
      eqBass, eqLowMid, eqMid, eqHighMid, eqTreble);

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.65;

    // Create the source last so failures before this point cannot reroute audio.
    // A media element can only acquire a source once. Keep that source usable
    // on detach/reinsert, and bound lifetime sources even if the page retains them.
    if (!source) {
      source = context.createMediaElementSource(el);
      frameAudioSourceCount += 1;
    } else {
      source.disconnect();
    }
    source.connect(eqBass);
    eqBass.connect(eqLowMid);
    eqLowMid.connect(eqMid);
    eqMid.connect(eqHighMid);
    eqHighMid.connect(eqTreble);
    eqTreble.connect(gain);
    gain.connect(analyser);
    analyser.connect(pan);
    pan.connect(output);
    output.connect(context.destination);

    el.xSoundFixerContext = context;
    el.xSoundFixerSource = source;
    el.xSoundFixerGain = gain;
    el.xSoundFixerAnalyser = analyser;
    el.xSoundFixerPan = pan;
    el.xSoundFixerSplit = split;
    el.xSoundFixerMerge = merge;
    el.xSoundFixerOutput = output;
    el.xSoundFixerEqBass = eqBass;
    el.xSoundFixerEqLowMid = eqLowMid;
    el.xSoundFixerEqMid = eqMid;
    el.xSoundFixerEqHighMid = eqHighMid;
    el.xSoundFixerEqTreble = eqTreble;
    el.xSoundFixerFlipped = false;
    el.xSoundFixerMode = 'full';
    activeAudioGraphCount += 1;

    return { success: true, capability: { mode: 'full', reason: null } };
  } catch (error) {
    console.warn(`Failed to create the audio graph for ${elid}:`, error);
    for (const node of createdNodes) {
      try { node.disconnect(); } catch (_) { /* Best-effort failed graph cleanup. */ }
    }

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

    if (context && frameAudioSourceCount === 0 && context.state !== 'closed') {
      context.close().catch(() => {});
      sharedAudioContext = null;
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
    el.xSoundFixerOutput.channelCount = settings.mono ? 1 : 2;
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
      el.xSoundFixerMerge.connect(el.xSoundFixerOutput);
    } else {
      el.xSoundFixerPan.connect(el.xSoundFixerOutput);
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

function notifyBadge(settings = frameSettings, disabled = frameDisabled) {
  browser.runtime.sendMessage({
    action: 'updateBadge',
    settings: { ...settings },
    disabled: disabled === true
  }).catch(() => {
    // The background may be restarting; the next change will refresh the badge.
  });
}

function getAudioLevel(el) {
  const analyser = el?.xSoundFixerAnalyser;
  const context = el?.xSoundFixerContext;
  if (!analyser || !context || context.state !== 'running') {
    return { peak: 0, clipping: false, contextState: context?.state || 'unavailable' };
  }

  let peak = 0;
  if (typeof analyser.getFloatTimeDomainData === 'function') {
    const samples = new Float32Array(analyser.fftSize || 256);
    analyser.getFloatTimeDomainData(samples);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  } else if (typeof analyser.getByteTimeDomainData === 'function') {
    const samples = new Uint8Array(analyser.fftSize || 256);
    analyser.getByteTimeDomainData(samples);
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
  }

  return {
    peak: Number(Math.min(2, peak).toFixed(4)),
    clipping: peak >= 0.98,
    contextState: context.state
  };
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
  const elid = getMediaId(el);
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
  const el = resolveMediaElement(elid);
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
    notifyBadge(frameSettings);
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
	siteExceptionKnown = true;
	frameDisabled = disabled === true;
	const media = [];
	scanMediaElements();
	for (const el of activeMediaElements.values()) {
		media.push(setElementSiteDisabled(el, frameDisabled));
	}
	notifyBadge(frameSettings, frameDisabled);
	return { success: true, disabled: frameDisabled, media };
}

function applyShortcut(command, resetSettings) {
  scanMediaElements();
  const elements = [...activeMediaElements.values()];
  if (frameDisabled || elements.length === 0) {
    return { success: false, applied: false, disabled: frameDisabled };
  }

  elements.forEach(registerMediaElement);
  const reference = elements.find(el => el.currentTime > 0 && !el.paused && !el.ended) || elements[0];
  const current = mergeSettings(frameSettings, reference.xSoundFixerSettings || {});
  let next = { ...current };

  if (command === 'increase-gain') {
    next.gain = clamp(Number((current.gain + 0.25).toFixed(2)), 0, 5);
  } else if (command === 'decrease-gain') {
    next.gain = clamp(Number((current.gain - 0.25).toFixed(2)), 0, 5);
  } else if (command === 'toggle-mono') {
    next.mono = !current.mono;
  } else if (command === 'reset-audio') {
    next = mergeSettings(DEFAULT_SETTINGS, resetSettings || DEFAULT_SETTINGS);
  } else {
    return { success: false, applied: false, error: `Unknown command: ${command}` };
  }

  frameSettings = mergeSettings(DEFAULT_SETTINGS, next);
  hasUserSettings = true;
  const media = elements.map(el => applySettingsToElement(el, frameSettings));
  notifyBadge(frameSettings);
  return { success: true, applied: media.some(result => result?.applied), settings: { ...frameSettings } };
}

function isMediaElement(el) {
  return el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') &&
    (typeof HTMLMediaElement === 'undefined' || el instanceof HTMLMediaElement);
}

function getMediaId(el) {
  return mediaIds.get(el);
}

function assignMediaId(el) {
  if (!activeMediaElements.has(getMediaId(el)) && activeMediaElements.size >= MAX_TRACKED_MEDIA_ELEMENTS) return null;
  if (!mediaIds.has(el)) mediaIds.set(el, `sa-${++nextMediaId}`);
  const id = getMediaId(el);
  activeMediaElements.set(id, el);
  return id;
}

function resolveMediaElement(id) {
  if (typeof id !== 'string' || id.length > 32) return null;
  const el = activeMediaElements.get(id);
  return isMediaElement(el) && el.isConnected !== false ? el : null;
}

function releaseMediaElement(el) {
  activeMediaElements.delete(getMediaId(el));
  clearTimeout(el.xSoundFixerRestoreTimer);
  if (!el.xSoundFixerGain) return;
  // Closing the context or disconnecting the source alone would silence this
  // element permanently. Keep its native-equivalent route alive for playback.
  el.xSoundFixerSource.disconnect();
  el.xSoundFixerSource.connect(el.xSoundFixerContext.destination);
  for (const key of PROCESSING_NODE_KEYS) {
    const node = el[`xSoundFixer${key}`];
    if (node) node.disconnect();
    delete el[`xSoundFixer${key}`];
  }
  delete el.xSoundFixerFlipped;
  activeAudioGraphCount -= 1;
}

function pruneRemovedMedia() {
  let changed = false;
  for (const el of activeMediaElements.values()) {
    if (el.isConnected === false) {
      releaseMediaElement(el);
      changed = true;
    }
  }
  return changed;
}

function notifyMediaChanged() {
  if (mediaChangeTimer !== null) return;
  mediaChangeTimer = setTimeout(() => {
    mediaChangeTimer = null;
    browser.runtime.sendMessage({ action: 'mediaElementsChanged' }).catch(() => {});
  }, 50);
}

function scheduleSettingsRestore(el) {
  if (!hasUserSettings || el.isConnected === false) return;
  clearTimeout(el.xSoundFixerRestoreTimer);
  el.xSoundFixerRestoreTimer = setTimeout(() => {
    if (el.isConnected === false) return;
    if (!assignMediaId(el)) return;
    applySettingsToElement(el, frameSettings);
  }, 0);
}

function registerMediaElement(el) {
  if (!isMediaElement(el) || el.isConnected === false) return;
  if (!assignMediaId(el)) return;
	el.xSoundFixerDisabled = frameDisabled;
  if (registeredMediaElements.has(el)) {
    if (hasUserSettings && !frameDisabled && !el.xSoundFixerGain) {
      applySettingsToElement(el, frameSettings);
    }
    return;
  }
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
  pruneRemovedMedia();
  let inspected = 0;
  for (const el of document.querySelectorAll('video, audio')) {
    if (inspected++ >= MAX_TRACKED_MEDIA_ELEMENTS) break;
    registerMediaElement(el);
  }
  const result = new Map();
  for (const [id, el] of activeMediaElements) result.set(id, getMediaState(el));
  return result;
}

async function loadInitialSettings() {
  try {
    const [siteResult, globalResult] = await Promise.all([
      browser.runtime.sendMessage({ action: 'getSiteProfile' }),
      browser.runtime.sendMessage({ action: 'getGlobalSettings' })
    ]);
    const initialSettings = siteResult?.remembered && siteResult.profile?.settings
      ? siteResult.profile.settings
      : globalResult?.enabled && globalResult.settings
        ? globalResult.settings
        : null;
    if (initialSettings) {
      frameSettings = mergeSettings(DEFAULT_SETTINGS, initialSettings);
      hasUserSettings = true;
      notifyBadge(frameSettings);
    }
  } catch (error) {
    console.warn('Unable to load the initial audio settings:', error);
  }
}

async function loadSiteExceptionStatus() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'getSiteExceptionStatus' });
		if (!result || typeof result.disabled !== 'boolean') throw new Error('Invalid site exception response');
		siteExceptionKnown = true;
		frameDisabled = result?.disabled === true;
	} catch (error) {
		console.warn('Unable to load the site exception status:', error);
		siteExceptionKnown = false;
		frameDisabled = true;
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

      case 'getAudioLevel': {
        const el = resolveMediaElement(message.elid);
        return el
          ? { success: true, ...getAudioLevel(el) }
          : { success: false, peak: 0, clipping: false, contextState: 'unavailable' };
      }

      case 'applyShortcut':
        return applyShortcut(message.command, message.settings);

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

  if (node.querySelectorAll && activeMediaElements.size < MAX_TRACKED_MEDIA_ELEMENTS) {
    const nestedMedia = node.querySelectorAll('video, audio');
    for (const el of nestedMedia) {
      if (activeMediaElements.size >= MAX_TRACKED_MEDIA_ELEMENTS) break;
      registerMediaElement(el);
    }
    mediaChanged = mediaChanged || nestedMedia.length > 0;
  }

  if (mediaChanged) {
    notifyMediaChanged();
  }
}

async function initialize() {
	await Promise.all([
		loadInitialSettings(),
		loadSiteExceptionStatus()
	]);
  notifyBadge(frameSettings, frameDisabled);
  scanMediaElements();

  const observer = new MutationObserver(mutations => {
    // Prune before registering additions so removed graphs free active slots.
    if (pruneRemovedMedia()) notifyMediaChanged();
    let inspected = 0;
    for (const mutation of mutations) {
      if (inspected++ >= MAX_TRACKED_MEDIA_ELEMENTS) break;
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (inspected++ >= MAX_TRACKED_MEDIA_ELEMENTS) break;
          registerMediaFromNode(node);
        }
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
