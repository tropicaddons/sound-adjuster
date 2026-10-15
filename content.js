'use strict';
globalThis.soundAdjusterContentLoaded = true;

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
const MAX_TRACKED_MEDIA_ELEMENTS = 128;
const MAX_SCANNED_MEDIA_ELEMENTS = 128;
const PAUSED_GRAPH_RELEASE_DELAY_MS = 1000;
const PLAYBACK_FADE_SECONDS = 0.006;
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
let siteDisabled = true;
let powerEnabled = false;
let powerStateKnown = false;
let powerRevision = -1;
let siteExceptionKnown = false;
let initializationPromise = null;
let mediaObserver = null;
const mediaEventRoots = new WeakSet();
let initialSettingsKnown = false;
let userSettingsChanged = false;
let initialRetryTimer = null;
let initialRetryCount = 0;
let shadowDiscoveryTimer = null;
let siteStatusRevision = 0;
let pageActive = true;

function scheduleShadowDiscovery(delay = 1000) {
	if (!pageActive || !mediaObserver || !hasUserSettings || frameDisabled) {
		clearTimeout(shadowDiscoveryTimer);
		shadowDiscoveryTimer = null;
		return;
	}
	if (shadowDiscoveryTimer !== null && delay > 0) return;
	clearTimeout(shadowDiscoveryTimer);
	shadowDiscoveryTimer = setTimeout(() => {
		shadowDiscoveryTimer = null;
		if (!hasUserSettings || frameDisabled) return;
		// Attaching a shadow root does not notify the surrounding document's
		// observer. Discover new roots without reapplying existing graphs.
		const roots = [];
		const elements = collectMediaElements(document, roots);
		if (roots.some(root => !mediaEventRoots.has(root))) {
			observeMediaRoots(roots);
			for (const el of elements) registerMediaElement(el);
			notifyMediaChanged();
		}
		scheduleShadowDiscovery();
	}, delay);
}

function scheduleInitialStateRetry() {
	if (!pageActive || initialRetryTimer !== null || initialRetryCount >= 3
		|| initialSettingsKnown && siteExceptionKnown && powerStateKnown) return;
	initialRetryTimer = setTimeout(async () => {
		initialRetryTimer = null;
		initialRetryCount += 1;
		await Promise.all([
			initialSettingsKnown ? undefined : loadInitialSettings(),
			siteExceptionKnown ? undefined : loadSiteExceptionStatus(),
			powerStateKnown ? undefined : loadPowerState()
		]);
		if (!pageActive) return;
		refreshDisabledState();
		scheduleInitialStateRetry();
	}, [250, 1000, 3000][initialRetryCount]);
}

// Read only by the extension's isolated-world probe after a failed delivery.
// A loaded script or a media tag alone is not evidence of unapplied audio.
globalThis.soundAdjusterPowerNeedsSync = (enabled, revision) => {
	const graphs = [...activeMediaElements.values()].filter(el => (el.xSoundFixerGain || el.xSoundFixerIdleOutput) && el.xSoundFixerContext);
	if (!graphs.length) return false;
	if (enabled) return !siteDisabled && (!powerEnabled || powerRevision < revision);
	return graphs.some(el => el.xSoundFixerIdleOutput ? el.xSoundFixerIdleOutput.gain.value !== 1 : el.xSoundFixerGain.gain.value !== 1 || el.xSoundFixerPan.pan.value !== 0
		|| el.xSoundFixerOutput.channelCount !== 2 || el.xSoundFixerFlipped === true
		|| ['EqBass', 'EqLowMid', 'EqMid', 'EqHighMid', 'EqTreble'].some(key => el[`xSoundFixer${key}`].gain.value !== 0));
};

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
	// A bound MediaElement source cannot be detached back to native playback.
	// Check changed resources even while OFF; a neutral gain cannot undo CORS.
	const source = el.currentSrc || el.src;
	let unsafeSource = false;
	try {
		const url = source && new URL(source, document.baseURI || window.location.href);
		unsafeSource = Boolean(url && ['http:', 'https:'].includes(url.protocol)
			&& url.origin !== (window.origin || window.location.origin) && el.crossOrigin === null);
	} catch (_) { /* The ordinary capability check below handles unknown sources. */ }
	if (el.xSoundFixerSource && (unsafeSource || el.mediaKeys)) {
		return { mode: 'unsupported', reason: 'media-reload-required' };
	}
	if (frameDisabled) {
		if (!powerStateKnown) return { mode: 'disabled', reason: 'power-state-unavailable' };
		if (!powerEnabled) return { mode: 'disabled', reason: 'power-off' };
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

  if (!source) {
    return { mode: 'pending', reason: 'media-not-ready' };
  }

  try {
    const sourceUrl = new URL(source, document.baseURI || window.location.href);
    const isHttpMedia = sourceUrl.protocol === 'http:' || sourceUrl.protocol === 'https:';
    // about:blank/srcdoc players inherit the document origin, although their
    // location URL itself has no HTTP origin.
    const frameOrigin = window.origin || window.location.origin;
    const isCrossOrigin = isHttpMedia && sourceUrl.origin !== frameOrigin;

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
  let source = el.xSoundFixerSource;
  const createdNodes = [];

  try {
    context = sharedAudioContext || (sharedAudioContext = new AudioContextClass());
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    const pan = context.createStereoPanner();
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const output = el.xSoundFixerIdleOutput || context.createGain();
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
    // on detach/reinsert. A frame's past videos must not exhaust future playback.
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
    delete el.xSoundFixerIdleOutput;
    el.xSoundFixerEqBass = eqBass;
    el.xSoundFixerEqLowMid = eqLowMid;
    el.xSoundFixerEqMid = eqMid;
    el.xSoundFixerEqHighMid = eqHighMid;
    el.xSoundFixerEqTreble = eqTreble;
    el.xSoundFixerFlipped = false;
    el.xSoundFixerMode = 'full';
    activeAudioGraphCount += 1;
    fadePlaybackOutput(el, isMediaPlaying(el));

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

function fadePlaybackOutput(el, playing, waitForPlaying = false) {
  const gain = el.xSoundFixerOutput?.gain;
  const context = el.xSoundFixerContext;
  if (!gain || !context) return;
  if (typeof gain.cancelScheduledValues !== 'function') {
    gain.value = playing && !waitForPlaying ? 1 : 0;
    return;
  }
  const now = context.currentTime;
  const start = playing ? 0 : gain.value;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(start, now);
  // play can precede decoded audio (buffering). Hold the onset gate until
  // playing, so the ramp does not finish before the first sample arrives.
  if (waitForPlaying) return;
  gain.linearRampToValueAtTime(playing ? 1 : 0, now + PLAYBACK_FADE_SECONDS);
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
  if (!isMediaPlaying(el) && !el.xSoundFixerGain) {
    // Feed players often preload many paused videos. Remember their controls,
    // but allocate processing nodes only when playback starts.
    el.xSoundFixerSettings = mergeSettings(el.xSoundFixerSettings, { ...pendingSettings, ...updates });
    return { success: true, applied: true, settings: { ...el.xSoundFixerSettings }, capability };
  }
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
    userSettingsChanged = true;
    frameSettings = mergeSettings(frameSettings, updates);
    hasUserSettings = true;
    notifyBadge(frameSettings);
  }

  return applySettingsToElement(el, updates);
}

function setElementSiteDisabled(el, disabled) {
	el.xSoundFixerDisabled = disabled === true;
	syncIdleOutput(el);
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
	siteStatusRevision += 1;
	siteExceptionKnown = true;
	siteDisabled = disabled === true;
	return refreshDisabledState();
}

function setPowerEnabled(enabled, revision = powerRevision) {
	if (revision < powerRevision) return { success: true, disabled: frameDisabled };
	powerRevision = revision;
	powerStateKnown = true;
	powerEnabled = enabled === true;
	return refreshDisabledState();
}

function refreshDisabledState() {
	frameDisabled = siteDisabled || !powerEnabled || !powerStateKnown;
	const media = [];
	scanMediaElements();
	for (const el of activeMediaElements.values()) {
		media.push(setElementSiteDisabled(el, frameDisabled));
	}
	notifyBadge(frameSettings, frameDisabled);
	scheduleShadowDiscovery();
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
  userSettingsChanged = true;
  hasUserSettings = true;
  const media = elements.map(el => applySettingsToElement(el, frameSettings));
  notifyBadge(frameSettings);
  scheduleShadowDiscovery();
  return { success: true, applied: media.some(result => result?.applied), settings: { ...frameSettings } };
}

function applyFrameSettings(updates) {
  // A popup can outlive any individual player on an SPA. Resolve the live
  // media here, and keep the requested frame settings across replacement gaps.
  scanMediaElements();
  frameSettings = mergeSettings(frameSettings, updates);
  userSettingsChanged = true;
  hasUserSettings = true;
  const results = [...activeMediaElements.values()].map(el => applySettingsToElement(el, frameSettings));
  notifyBadge(frameSettings, frameDisabled);
  scheduleShadowDiscovery();
  return {
    success: results.every(result => result.success === true),
    applied: results.some(result => result.applied === true),
    settings: { ...frameSettings },
    media: Object.fromEntries(getMediaSnapshot())
  };
}

function isMediaElement(el) {
  if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return false;
  if (typeof HTMLMediaElement === 'undefined') return true;
  try {
    // An adopted player keeps its original frame's prototype. instanceof
    // rejects it in the new frame; the native getter checks the actual brand.
    const pausedGetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused')?.get;
    if (!pausedGetter) return el instanceof HTMLMediaElement;
    pausedGetter.call(el);
    return true;
  } catch (_) {
    return false;
  }
}

function isMediaPlaying(el) {
  return !el.paused && !el.ended;
}

function collectMediaElements(root = document, shadowRoots = []) {
  const elements = [...root.querySelectorAll('video, audio')];
  // querySelectorAll does not cross a player's shadow boundary. Firefox gives
  // extensions access to both open and closed roots without page-world code.
  for (const host of root.querySelectorAll('*')) {
    const shadow = host.openOrClosedShadowRoot || host.shadowRoot;
    if (!shadow) continue;
    shadowRoots.push(shadow);
    elements.push(...collectMediaElements(shadow, shadowRoots));
  }
  return elements;
}

function handleMediaPlay(event) {
  if (!isMediaElement(event.target)) return;
  pruneRemovedMedia();
  registerMediaElement(event.target);
  scheduleSettingsRestore(event.target);
  notifyMediaChanged();
}

function observeMediaRoots(shadowRoots) {
  if (!mediaObserver) return;
  // Rebuild from connected roots so removed feed widgets are not retained.
  mediaObserver.disconnect();
  const options = { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] };
  for (const root of [document.body, ...shadowRoots]) {
    if (!root) continue;
    mediaObserver.observe(root, options);
    if (!mediaEventRoots.has(root)) {
      root.addEventListener('play', handleMediaPlay, true);
      mediaEventRoots.add(root);
    }
  }
}

function getMediaId(el) {
  return mediaIds.get(el);
}

function assignMediaId(el) {
  if (!activeMediaElements.has(getMediaId(el)) && activeMediaElements.size >= MAX_TRACKED_MEDIA_ELEMENTS) {
    const inactive = [...activeMediaElements.values()].find(candidate => !isMediaPlaying(candidate));
    if (inactive) releaseMediaElement(inactive);
    // Bound idle bookkeeping, not playback. Hidden feed players can remain
    // unpaused; their number must never prevent a new player from working.
    else if (!isMediaPlaying(el)) return null;
  }
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
  releaseAudioGraph(el, false);
}

function releaseAudioGraph(el, keepIdleGuard = true) {
  clearTimeout(el.xSoundFixerRestoreTimer);
  clearTimeout(el.xSoundFixerPauseTimer);
  el.xSoundFixerPauseTimer = null;
  if (!el.xSoundFixerGain) {
    if ((!keepIdleGuard || el.isConnected === false) && el.xSoundFixerIdleOutput) {
      el.xSoundFixerIdleOutput.disconnect();
      delete el.xSoundFixerIdleOutput;
      el.xSoundFixerSource.disconnect();
      el.xSoundFixerSource.connect(el.xSoundFixerContext.destination);
    }
    return;
  }
  // Release filters/analysis while idle, but do not expose a unity-gain route
  // before a background-throttled autoplay callback can restore the settings.
  el.xSoundFixerSource.disconnect();
  if (keepIdleGuard && el.isConnected !== false) {
    el.xSoundFixerIdleOutput = el.xSoundFixerOutput;
    syncIdleOutput(el);
    el.xSoundFixerIdleOutput.disconnect();
    el.xSoundFixerSource.connect(el.xSoundFixerIdleOutput);
    el.xSoundFixerIdleOutput.connect(el.xSoundFixerContext.destination);
  } else {
    el.xSoundFixerSource.connect(el.xSoundFixerContext.destination);
  }
  for (const key of PROCESSING_NODE_KEYS) {
    const node = el[`xSoundFixer${key}`];
    if (node && node !== el.xSoundFixerIdleOutput) node.disconnect();
    delete el[`xSoundFixer${key}`];
  }
  delete el.xSoundFixerFlipped;
  activeAudioGraphCount -= 1;
}

function syncIdleOutput(el) {
  const gain = el.xSoundFixerIdleOutput?.gain;
  if (!gain) return;
  el.xSoundFixerIdleOutput.channelCount = 2;
  const value = frameDisabled || !hasUserSettings ? 1 : 0;
  if (typeof gain.cancelScheduledValues === 'function') {
    const now = el.xSoundFixerContext.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(value, now);
  } else gain.value = value;
}

function schedulePausedGraphRelease(el) {
  if (!el.xSoundFixerGain || el.xSoundFixerPauseTimer != null) return;
  // Keep the route and filter history across a quick pause/replay. Rewiring
  // every pause cuts filter tails and rebuilds the graph at the next onset.
  el.xSoundFixerPauseTimer = setTimeout(() => {
    el.xSoundFixerPauseTimer = null;
    if (isMediaPlaying(el)) return;
    releaseAudioGraph(el);
    notifyMediaChanged();
  }, PAUSED_GRAPH_RELEASE_DELAY_MS);
}

function pruneRemovedMedia() {
  let changed = false;
  for (const el of activeMediaElements.values()) {
    if (el.isConnected === false) {
      releaseMediaElement(el);
      changed = true;
    } else if (!isMediaPlaying(el) && el.xSoundFixerGain) {
      schedulePausedGraphRelease(el);
    }
  }
  while (activeMediaElements.size > MAX_TRACKED_MEDIA_ELEMENTS) {
    const inactive = [...activeMediaElements.values()].find(el => !isMediaPlaying(el));
    if (!inactive) break;
    releaseMediaElement(inactive);
    changed = true;
  }
  return changed;
}

function notifyMediaChanged() {
  if (mediaChangeTimer !== null) return;
  mediaChangeTimer = setTimeout(() => {
    mediaChangeTimer = null;
    scanMediaElements();
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
  syncIdleOutput(el);
  if (isMediaPlaying(el)) {
    clearTimeout(el.xSoundFixerPauseTimer);
    el.xSoundFixerPauseTimer = null;
  }
  if (!assignMediaId(el)) return;
	el.xSoundFixerDisabled = frameDisabled;
  if (registeredMediaElements.has(el)) {
    if (hasUserSettings && !frameDisabled && !el.xSoundFixerGain) {
      applySettingsToElement(el, frameSettings);
    }
    return;
  }
  registeredMediaElements.add(el);

  for (const event of ['loadstart', 'loadedmetadata']) {
    el.addEventListener(event, () => {
      scheduleSettingsRestore(el);
      notifyMediaChanged();
    });
  }
  el.addEventListener('play', () => {
    resumeAudioContext(el);
    fadePlaybackOutput(el, true, true);
    scheduleSettingsRestore(el);
  });
  for (const event of ['pause', 'ended', 'emptied']) {
    el.addEventListener(event, () => {
      if (!isMediaPlaying(el)) {
        fadePlaybackOutput(el, false);
        schedulePausedGraphRelease(el);
      }
      notifyMediaChanged();
    });
  }
  el.addEventListener('playing', () => {
    resumeAudioContext(el);
    fadePlaybackOutput(el, true);
  });
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
		siteDisabled,
		powerEnabled
  };
}

function scanMediaElements() {
  pruneRemovedMedia();
  const shadowRoots = [];
  const elements = collectMediaElements(document, shadowRoots);
  observeMediaRoots(shadowRoots);
  // Playing media can be after a feed's retained or preloaded DOM players.
  for (const el of elements.filter(isMediaPlaying)) {
    registerMediaElement(el);
  }
  for (const el of elements) {
    if (activeMediaElements.size >= MAX_TRACKED_MEDIA_ELEMENTS) break;
    if (!activeMediaElements.has(getMediaId(el))) registerMediaElement(el);
  }
  return getMediaSnapshot();
}

function getMediaSnapshot() {
  // IPC/UI payloads stay bounded. Settings still reach every tracked playing
  // element; return recent playing media first so a new feed player is visible.
  const entries = [...activeMediaElements].reverse();
  const prioritized = [...entries.filter(([, el]) => isMediaPlaying(el)),
    ...entries.filter(([, el]) => !isMediaPlaying(el))];
  return new Map(prioritized.slice(0, MAX_SCANNED_MEDIA_ELEMENTS)
    .map(([id, el]) => [id, getMediaState(el)]));
}

async function loadInitialSettings() {
  try {
    const results = await Promise.allSettled([
      browser.runtime.sendMessage({ action: 'getSiteProfile' }),
      browser.runtime.sendMessage({ action: 'getGlobalSettings' })
    ]);
    const [siteResult, globalResult] = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const siteKnown = typeof siteResult?.remembered === 'boolean';
    const globalKnown = typeof globalResult?.enabled === 'boolean';
    initialSettingsKnown = siteKnown && globalKnown;
    const initialSettings = siteKnown && siteResult?.remembered && siteResult.profile?.settings
      ? siteResult.profile.settings
      : siteKnown && globalResult?.enabled && globalResult.settings
        ? globalResult.settings
        : null;
    if (initialSettings && !userSettingsChanged) {
      frameSettings = mergeSettings(DEFAULT_SETTINGS, initialSettings);
      hasUserSettings = true;
      notifyBadge(frameSettings);
    }
  } catch (error) {
    console.warn('Unable to load the initial audio settings:', error);
  }
}

async function loadSiteExceptionStatus() {
	const revision = siteStatusRevision;
	try {
		const result = await browser.runtime.sendMessage({ action: 'getSiteExceptionStatus' });
		if (revision !== siteStatusRevision) return;
		if (!result || typeof result.disabled !== 'boolean') throw new Error('Invalid site exception response');
		siteExceptionKnown = true;
		siteDisabled = result?.disabled === true;
	} catch (error) {
		if (revision !== siteStatusRevision) return;
		console.warn('Unable to load the site exception status:', error);
		siteExceptionKnown = false;
		siteDisabled = true;
	}
	frameDisabled = siteDisabled || !powerEnabled || !powerStateKnown;
}

async function loadPowerState() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'getPowerState' });
		if (!result?.eligible || typeof result.enabled !== 'boolean') throw new Error('Power state unavailable');
		const revision = Number.isSafeInteger(result.revision) ? result.revision : 0;
		if (revision < powerRevision) return;
		powerRevision = revision;
		powerStateKnown = true;
		powerEnabled = result.enabled;
	} catch (error) {
		console.warn('Unable to read the power state:', error);
		powerStateKnown = false;
		powerEnabled = false;
	}
	frameDisabled = siteDisabled || !powerEnabled || !powerStateKnown;
}

async function handleMessage(message) {
  try {
    if (initializationPromise) await initializationPromise;
		if (!powerStateKnown && message.action !== 'setPowerEnabled') {
			await loadPowerState();
			if (powerStateKnown) refreshDisabledState();
		}
    if (!siteExceptionKnown && message.action !== 'setSiteDisabled') {
      await loadSiteExceptionStatus();
      if (siteExceptionKnown && !hasUserSettings) await loadInitialSettings();
    }

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

      case 'applyFrameSettings':
        return applyFrameSettings(message.settings);

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
		case 'setPowerEnabled':
			return setPowerEnabled(message.enabled, message.revision);

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
    const nestedMedia = collectMediaElements(node);
    for (const el of nestedMedia) {
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
		loadSiteExceptionStatus(),
		loadPowerState()
	]);
  notifyBadge(frameSettings, frameDisabled);
  scanMediaElements();

  // Capture play even for an element outside the bounded idle registry.
  document.addEventListener('play', handleMediaPlay, true);

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
        notifyMediaChanged();
      }
    }
  });

  mediaObserver = observer;
  scanMediaElements();
	// A user gesture can create an entire closed player root in one task.
	// Inspect after that task, rather than waiting for the next periodic pass.
	for (const event of ['click', 'keydown']) {
		document.addEventListener(event, () => scheduleShadowDiscovery(0), true);
	}
	scheduleShadowDiscovery();
	scheduleInitialStateRetry();

  window.soundAdjusterObserver = observer;
}

browser.runtime.onMessage.addListener(handleMessage);

window.addEventListener('pageshow', event => {
	pageActive = true;
	if (event.persisted) loadPowerState().then(() => { refreshDisabledState(); scheduleInitialStateRetry(); });
});

window.addEventListener('pagehide', () => {
	pageActive = false;
	clearTimeout(initialRetryTimer);
	initialRetryTimer = null;
	clearTimeout(shadowDiscoveryTimer);
	shadowDiscoveryTimer = null;
});

if (document.readyState === 'loading') {
  initializationPromise = new Promise(resolve => {
    document.addEventListener('DOMContentLoaded', () => {
      initialize().finally(resolve);
    }, { once: true });
  });
} else {
  initializationPromise = initialize();
}
