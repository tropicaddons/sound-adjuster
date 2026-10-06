'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentScript = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

class FakeAudioNode {
  constructor() {
    this.gain = { value: 1 };
    this.pan = { value: 0 };
    this.frequency = { value: 0 };
    this.Q = { value: 0 };
    this.threshold = { value: 0 };
    this.knee = { value: 0 };
    this.ratio = { value: 1 };
    this.attack = { value: 0 };
    this.release = { value: 0 };
    this.fftSize = 256;
    this.smoothingTimeConstant = 0;
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.connections = [];
  }

  getFloatTimeDomainData(samples) {
    samples.fill(0.5);
  }
}

class FakeAudioContext {
  static instances = 0;
  static initialState = 'running';
  static resumeAllowed = true;
  static resumeCalls = 0;
  static sourceElements = new WeakSet();
  static sources = [];

  constructor() {
    FakeAudioContext.instances += 1;
    this.state = FakeAudioContext.initialState;
    this.destination = new FakeAudioNode();
    this.destination.channelCount = 2;
  }

  createGain() { return new FakeAudioNode(); }
  createAnalyser() { return new FakeAudioNode(); }
  createDynamicsCompressor() { return new FakeAudioNode(); }
  createStereoPanner() { return new FakeAudioNode(); }
  createChannelSplitter() { return new FakeAudioNode(); }
  createChannelMerger() { return new FakeAudioNode(); }
  createBiquadFilter() { return new FakeAudioNode(); }
  createMediaElementSource(element) {
    if (FakeAudioContext.sourceElements.has(element)) {
      throw new Error('InvalidStateError: this media element already has a source');
    }
    FakeAudioContext.sourceElements.add(element);
    const source = new FakeAudioNode();
    source.context = this;
    FakeAudioContext.sources.push(source);
    return source;
  }
  resume() {
    FakeAudioContext.resumeCalls += 1;
    if (!FakeAudioContext.resumeAllowed) {
      return Promise.reject(new Error('Audio resume is blocked until user activation'));
    }
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

class FakeMediaElement {
  constructor(source = '') {
    this.tagName = 'VIDEO';
    this.nodeType = 1;
    this.isConnected = true;
    this.currentSrc = source;
    this.src = source;
    this.crossOrigin = null;
    this.mediaKeys = null;
    this.currentTime = 1;
    this.paused = false;
    this.ended = false;
    this.readyState = 4;
    this.volume = 1;
    this.muted = false;
    this.attributes = new Map();
    this.listeners = new Map();
  }

  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  matches(selector) { return selector === 'video, audio'; }
  closest(selector) { return this.matches(selector) ? this : null; }
  querySelectorAll() { return []; }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  dispatch(type) {
    for (const callback of this.listeners.get(type) || []) callback({ target: this });
  }
}

async function loadContentScript(pageUrl, initialMedia, profileResult = null, options = {}) {
  let messageListener;
  let mutationCallback;
  const media = [...initialMedia];
  const runtimeMessages = [];
  const pageLocation = new URL(pageUrl);

  FakeAudioContext.instances = 0;
  FakeAudioContext.initialState = options.audioContextState || 'running';
  FakeAudioContext.resumeAllowed = options.audioResumeAllowed !== false;
  FakeAudioContext.resumeCalls = 0;
  FakeAudioContext.sourceElements = new WeakSet();
  FakeAudioContext.sources = [];

  const document = {
    readyState: 'complete',
    body: {},
    querySelectorAll(selector) {
      return selector === 'video, audio' ? media : [];
    },
    querySelector(selector) {
      const match = selector.match(/data-x-soundfixer-id="([^"]+)"/);
      return match
        ? media.find(element => element.getAttribute('data-x-soundfixer-id') === match[1]) || null
        : null;
    },
    addEventListener() {}
  };

  class FakeMutationObserver {
    constructor(callback) { mutationCallback = callback; }
    observe() {}
  }

  const context = vm.createContext({
    URL,
    console,
    document,
    MutationObserver: FakeMutationObserver,
    Node: { ELEMENT_NODE: 1 },
    HTMLMediaElement: FakeMediaElement,
    setTimeout,
    clearTimeout,
    window: {
      location: pageLocation,
      AudioContext: FakeAudioContext
    },
    browser: {
      runtime: {
        sendMessage(message) {
          runtimeMessages.push(message);
          if (message.action === 'getSiteProfile') {
            return Promise.resolve(profileResult || {
              eligible: true,
              remembered: false,
              profile: null
            });
          }
          if (message.action === 'getSiteExceptionStatus') {
            if (options.exceptionError) return Promise.reject(new Error('Storage unavailable'));
            if (options.exceptionMalformed) return Promise.resolve({ error: 'Unavailable' });
            return Promise.resolve(options.exceptionResult || {
              eligible: true,
              siteKey: pageLocation.hostname,
              disabled: false
            });
          }
          if (message.action === 'getGlobalSettings') {
            return Promise.resolve(options.globalSettingsResult || {
              eligible: true,
              enabled: false,
              settings: null
            });
          }
          return Promise.resolve(undefined);
        },
        onMessage: {
          addListener(listener) { messageListener = listener; }
        }
      }
    }
  });

  vm.runInContext(contentScript, context, { filename: 'content.js' });
  await new Promise(resolve => setImmediate(resolve));

  async function send(message) {
    return messageListener(message, {});
  }

  function addMedia(element) {
    element.isConnected = true;
    media.push(element);
    mutationCallback([{ type: 'childList', addedNodes: [element], removedNodes: [] }]);
  }

  function removeMedia(element) {
    media.splice(media.indexOf(element), 1);
    element.isConnected = false;
    mutationCallback([{ type: 'childList', addedNodes: [], removedNodes: [element] }]);
  }

  function allowAudioResume() {
    FakeAudioContext.resumeAllowed = true;
  }

  const getMediaId = vm.runInContext('getMediaId', context);
  return { addMedia, removeMedia, allowAudioResume, media, runtimeMessages, send, getMediaId };
}

function firstMediaEntry(scanResponse) {
  return Object.values(scanResponse.media)[0];
}

function assertSettings(actual, expected) {
	for (const [name, value] of Object.entries(expected)) {
		assert.equal(actual[name], value, `${name} should match`);
	}
}

test('TikTok stays in safe mode and never creates a Web Audio graph', async () => {
  const video = new FakeMediaElement('https://v16.tiktokcdn.com/video.mp4');
  const environment = await loadContentScript('https://www.tiktok.com/@creator/video/1', [video]);
  const scan = await environment.send({ action: 'scanMedia' });
  const mediaId = environment.getMediaId(video);

  assert.equal(firstMediaEntry(scan).capability.mode, 'basic');
  assert.equal(firstMediaEntry(scan).capability.reason, 'site-restricted');

  const result = await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 3 }
  });

  assert.equal(result.applied, false);
  assert.equal(result.capability.mode, 'basic');
  assert.equal(FakeAudioContext.instances, 0);
  assert.equal(video.volume, 1);
});

test('cross-origin media without CORS is not connected to Web Audio', async () => {
  const video = new FakeMediaElement('https://media.example-cdn.test/video.mp4');
  const environment = await loadContentScript('https://example.test/feed', [video]);
  const scan = await environment.send({ action: 'scanMedia' });

  assert.equal(firstMediaEntry(scan).capability.mode, 'basic');
  assert.equal(firstMediaEntry(scan).capability.reason, 'cross-origin-media');
  assert.equal(FakeAudioContext.instances, 0);
});

test('a site exception skips graph creation and live enable restores saved settings', async () => {
  const video = new FakeMediaElement('https://example.test/video.mp4');
  const environment = await loadContentScript(
    'https://example.test/watch',
    [video],
    null,
    {
      exceptionResult: {
        eligible: true,
        siteKey: 'example.test',
        disabled: true
      }
    }
  );
  const mediaId = environment.getMediaId(video);
  const disabledScan = await environment.send({ action: 'scanMedia' });

  assert.equal(firstMediaEntry(disabledScan).capability.mode, 'disabled');
  assert.equal(firstMediaEntry(disabledScan).capability.reason, 'site-exception');
  assert.equal(FakeAudioContext.instances, 0);

  const deferred = await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 2.5, eqBass: 4 }
  });
  assert.equal(deferred.applied, false);
  assert.equal(FakeAudioContext.instances, 0);

  const enabled = await environment.send({ action: 'setSiteDisabled', disabled: false });
  assert.equal(enabled.disabled, false);
  assert.equal(FakeAudioContext.instances, 1);
  assert.equal(video.xSoundFixerGain.gain.value, 2.5);
  assert.equal(video.xSoundFixerEqBass.gain.value, 4);

  const disabledAgain = await environment.send({ action: 'setSiteDisabled', disabled: true });
  assert.equal(disabledAgain.disabled, true);
  assert.equal(video.xSoundFixerGain.gain.value, 1);
  assert.equal(video.xSoundFixerEqBass.gain.value, 0);
  assert.equal(FakeAudioContext.instances, 1);

  await environment.send({ action: 'setSiteDisabled', disabled: false });
  assert.equal(video.xSoundFixerGain.gain.value, 2.5);
  assert.equal(video.xSoundFixerEqBass.gain.value, 4);
  assert.equal(FakeAudioContext.instances, 1);
});

test('the last gain is applied to a new same-origin feed video', async () => {
  const firstVideo = new FakeMediaElement('https://www.instagram.com/video/first.mp4');
  const environment = await loadContentScript('https://www.instagram.com/reels/', [firstVideo]);
  const mediaId = environment.getMediaId(firstVideo);

  const result = await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 2.4 }
  });

  await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { pan: 0.35, eqBass: 4 }
  });

  assert.equal(result.applied, true);
  assert.equal(firstVideo.xSoundFixerGain.gain.value, 2.4);

  const nextVideo = new FakeMediaElement('https://www.instagram.com/video/next.mp4');
  environment.addMedia(nextVideo);

  assert.equal(nextVideo.xSoundFixerGain.gain.value, 2.4);
  assert.equal(nextVideo.xSoundFixerPan.pan.value, 0.35);
  assert.equal(nextVideo.xSoundFixerEqBass.gain.value, 4);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(
    environment.runtimeMessages.some(message => message.action === 'mediaElementsChanged'),
    true
  );
});

test('settings are restored after a newly added video finishes loading', async () => {
  const firstVideo = new FakeMediaElement('https://example.test/first.mp4');
  const environment = await loadContentScript('https://example.test/feed', [firstVideo]);
  const mediaId = environment.getMediaId(firstVideo);

  await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 1.8 }
  });

  const nextVideo = new FakeMediaElement('');
  environment.addMedia(nextVideo);
  assert.equal(nextVideo.xSoundFixerGain, undefined);

  nextVideo.currentSrc = 'https://example.test/second.mp4';
  nextVideo.src = nextVideo.currentSrc;
  nextVideo.dispatch('loadedmetadata');
  await new Promise(resolve => setTimeout(resolve, 5));

	assert.equal(nextVideo.xSoundFixerGain.gain.value, 1.8);
});

test('Instagram first video resumes its suspended graph when unmuted without scrolling', async () => {
  const video = new FakeMediaElement('https://www.instagram.com/video/first.mp4');
  video.muted = true;
  const environment = await loadContentScript(
    'https://www.instagram.com/',
    [video],
    {
      eligible: true,
      remembered: true,
      profile: {
        version: 1,
        siteKey: 'instagram.com',
        settings: { gain: 1.75 },
        updatedAt: 1
      }
    },
    { audioContextState: 'suspended', audioResumeAllowed: false }
  );

  assert.equal(video.xSoundFixerContext.state, 'suspended');
  assert.equal(FakeAudioContext.resumeCalls, 1);
  assert.equal(FakeAudioContext.instances, 1);

  environment.allowAudioResume();
  video.muted = false;
  video.dispatch('volumechange');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(video.xSoundFixerContext.state, 'running');
  assert.equal(FakeAudioContext.resumeCalls, 2);
  assert.equal(FakeAudioContext.instances, 1);
  assert.equal(video.xSoundFixerGain.gain.value, 1.75);
});

test('play and playing retry a suspended graph immediately without recreating it', async () => {
  const video = new FakeMediaElement('https://www.instagram.com/video/reel.mp4');
  const environment = await loadContentScript(
    'https://www.instagram.com/reels/',
    [video],
    {
      eligible: true,
      remembered: true,
      profile: {
        version: 1,
        siteKey: 'instagram.com',
        settings: { gain: 2.1 },
        updatedAt: 1
      }
    },
    { audioContextState: 'suspended', audioResumeAllowed: false }
  );

  environment.allowAudioResume();
  video.dispatch('play');
  assert.equal(video.xSoundFixerContext.state, 'running');
  assert.equal(FakeAudioContext.instances, 1);

  video.xSoundFixerContext.state = 'suspended';
  video.dispatch('playing');
  assert.equal(video.xSoundFixerContext.state, 'running');
  assert.equal(FakeAudioContext.instances, 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(video.xSoundFixerGain.gain.value, 2.1);
});

test('media resume events are idempotent and never create a graph in safe mode', async () => {
  const instagramVideo = new FakeMediaElement('https://www.instagram.com/video/active.mp4');
  const instagramEnvironment = await loadContentScript(
    'https://www.instagram.com/',
    [instagramVideo],
    {
      eligible: true,
      remembered: true,
      profile: {
        version: 1,
        siteKey: 'instagram.com',
        settings: { gain: 1.4 },
        updatedAt: 1
      }
    }
  );

  instagramVideo.dispatch('volumechange');
  instagramVideo.dispatch('play');
  instagramVideo.dispatch('playing');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(FakeAudioContext.resumeCalls, 0);
  assert.equal(FakeAudioContext.instances, 1);

  const tiktokVideo = new FakeMediaElement('https://v16.tiktokcdn.com/video.mp4');
  const tiktokEnvironment = await loadContentScript(
    'https://www.tiktok.com/@creator/video/1',
    [tiktokVideo],
    {
      eligible: true,
      remembered: true,
      profile: {
        version: 1,
        siteKey: 'tiktok.com',
        settings: { gain: 3 },
        updatedAt: 1
      }
    },
    { audioContextState: 'suspended', audioResumeAllowed: false }
  );

  tiktokEnvironment.allowAudioResume();
  tiktokVideo.dispatch('volumechange');
  tiktokVideo.dispatch('play');
  tiktokVideo.dispatch('playing');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(FakeAudioContext.instances, 0);
  assert.equal(FakeAudioContext.resumeCalls, 0);
});

test('scan returns every applied setting for popup restoration', async () => {
	const video = new FakeMediaElement('https://example.test/video.mp4');
	const environment = await loadContentScript('https://example.test/watch', [video]);
	const mediaId = environment.getMediaId(video);
	const settings = {
		gain: 2.25,
		pan: -0.45,
		mono: true,
		flip: true,
		eqBass: 4,
		eqLowMid: 2,
		eqMid: -1,
		eqHighMid: 3,
		eqTreble: 5
	};

	await environment.send({
		action: 'applySettings',
		elid: mediaId,
		settings
	});

	const restored = firstMediaEntry(await environment.send({ action: 'scanMedia' })).settings;
	for (const [name, value] of Object.entries(settings)) {
		assert.equal(restored[name], value, `${name} should be returned to the popup`);
	}
});

test('gain stays capped at 5x and legacy boost or limiter settings are discarded', async () => {
  const video = new FakeMediaElement('https://example.com/video.mp4');
  const environment = await loadContentScript('https://example.com/watch', [video]);
  const mediaId = environment.getMediaId(video);

  const clamped = await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 9 }
  });
  assert.equal(clamped.settings.gain, 5);

  const migrated = await environment.send({
    action: 'applySettings',
    elid: mediaId,
    settings: { gain: 9, extraBoost: true, limiter: true }
  });
  assert.equal(migrated.settings.gain, 5);
  assert.equal('extraBoost' in migrated.settings, false);
  assert.equal('limiter' in migrated.settings, false);
  assert.equal(video.xSoundFixerGain.gain.value, 5);
  assert.equal(video.xSoundFixerLimiter, undefined);
  assert.deepEqual(video.xSoundFixerAnalyser.connections, [video.xSoundFixerPan]);

  const level = await environment.send({ action: 'getAudioLevel', elid: mediaId });
  assert.equal(level.success, true);
  assert.equal(level.peak, 0.5);
  assert.equal(level.clipping, false);
});

test('keyboard commands adjust the active frame and publish badge state', async () => {
  const video = new FakeMediaElement('https://example.com/video.mp4');
  const environment = await loadContentScript('https://example.com/watch', [video]);

  const raised = await environment.send({ action: 'applyShortcut', command: 'increase-gain' });
  assert.equal(raised.success, true);
  assert.equal(raised.settings.gain, 1.25);
  assert.equal(video.xSoundFixerGain.gain.value, 1.25);

  const mono = await environment.send({ action: 'applyShortcut', command: 'toggle-mono' });
  assert.equal(mono.settings.mono, true);
  assert.equal(environment.runtimeMessages.some(message => (
    message.action === 'updateBadge' && message.settings?.mono === true
  )), true);

  const reset = await environment.send({ action: 'applyShortcut', command: 'reset-audio' });
  assert.equal(reset.settings.gain, 1);
  assert.equal(reset.settings.mono, false);
});

test('reset changes actual gain, pan and all EQ nodes on every media element and later media', async () => {
  const videos = [new FakeMediaElement('https://example.com/one.wav'), new FakeMediaElement('https://example.com/two.wav')];
  const environment = await loadContentScript('https://example.com/watch', videos);
  await environment.send({ action: 'scanMedia' });
  for (const video of videos) {
    await environment.send({ action: 'applySettings', elid: environment.getMediaId(video), settings: {
      gain: 4, pan: 0.7, mono: true, flip: true, eqBass: 9, eqLowMid: 8, eqMid: 7, eqHighMid: 6, eqTreble: 5
    } });
  }
  const defaults = { gain: 2, pan: -0.2, mono: false, flip: false, eqBass: 4, eqLowMid: 2, eqMid: -1, eqHighMid: 2, eqTreble: 3 };
  const reset = await environment.send({ action: 'applyShortcut', command: 'reset-audio', settings: defaults });
  assert.equal(reset.applied, true);
  const later = new FakeMediaElement('https://example.com/later.wav');
  environment.addMedia(later);
  for (const video of [...videos, later]) {
    assertSettings(video.xSoundFixerSettings, defaults);
    assert.equal(video.xSoundFixerGain.gain.value, 2);
    assert.equal(video.xSoundFixerPan.pan.value, -0.2);
    for (const band of ['Bass', 'LowMid', 'Mid', 'HighMid', 'Treble']) {
      assert.equal(video[`xSoundFixerEq${band}`].gain.value, defaults[`eq${band}`]);
    }
  }
  const neutral = await environment.send({ action: 'applyShortcut', command: 'reset-audio' });
  assert.equal(neutral.settings.gain, 1);
  for (const video of [...videos, later]) {
    assert.equal(video.xSoundFixerGain.gain.value, 1);
    for (const band of ['Bass', 'LowMid', 'Mid', 'HighMid', 'Treble']) assert.equal(video[`xSoundFixerEq${band}`].gain.value, 0);
    assert.equal(video.xSoundFixerSettings.mono, false);
    assert.equal(video.xSoundFixerSettings.flip, false);
  }
});

test('remembered site settings override enabled global defaults', async () => {
  const globalVideo = new FakeMediaElement('https://example.com/global.mp4');
  const globalEnvironment = await loadContentScript(
    'https://example.com/global',
    [globalVideo],
    null,
    {
      globalSettingsResult: {
        eligible: true,
        enabled: true,
		settings: { gain: 7, extraBoost: true, limiter: true }
      }
    }
  );
  const globalScan = await globalEnvironment.send({ action: 'scanMedia' });
  assert.equal(firstMediaEntry(globalScan).settings.gain, 5);
  assert.equal('extraBoost' in firstMediaEntry(globalScan).settings, false);
  assert.equal('limiter' in firstMediaEntry(globalScan).settings, false);

  const siteVideo = new FakeMediaElement('https://example.com/site.mp4');
  const siteEnvironment = await loadContentScript(
    'https://example.com/site',
    [siteVideo],
    {
      eligible: true,
      remembered: true,
      profile: { settings: { gain: 2 } }
    },
    {
      globalSettingsResult: {
        eligible: true,
        enabled: true,
        settings: { gain: 7, extraBoost: true, limiter: true }
      }
    }
  );
  const siteScan = await siteEnvironment.send({ action: 'scanMedia' });
  assert.equal(firstMediaEntry(siteScan).settings.gain, 2);
  assert.equal('extraBoost' in firstMediaEntry(siteScan).settings, false);
  assert.equal('limiter' in firstMediaEntry(siteScan).settings, false);
});

test('a remembered profile is applied before the first scan and to later media', async () => {
	const settings = {
		gain: 2.6,
		pan: -0.3,
		mono: true,
		flip: true,
		eqBass: 5,
		eqLowMid: 2,
		eqMid: -1,
		eqHighMid: 3,
		eqTreble: 4
	};
	const firstVideo = new FakeMediaElement('https://example.test/first.mp4');
	const environment = await loadContentScript(
		'https://example.test/watch',
		[firstVideo],
		{
			eligible: true,
			remembered: true,
			profile: { version: 1, siteKey: 'example.test', settings, updatedAt: 1 }
		}
	);

	const firstScan = await environment.send({ action: 'scanMedia' });
	assertSettings(firstMediaEntry(firstScan).settings, settings);
	assert.equal(firstVideo.xSoundFixerGain.gain.value, 2.6);
	assert.equal(firstVideo.xSoundFixerPan.pan.value, -0.3);
	assert.equal(firstVideo.xSoundFixerEqTreble.gain.value, 4);

	const laterVideo = new FakeMediaElement('https://example.test/later.mp4');
	environment.addMedia(laterVideo);
	assert.equal(laterVideo.xSoundFixerGain.gain.value, 2.6);
	assert.equal(laterVideo.xSoundFixerEqBass.gain.value, 5);
});

test('page-controlled duplicate and selector-injection attributes cannot target media', async () => {
  const videos = [new FakeMediaElement('https://example.test/a.wav'), new FakeMediaElement('https://example.test/b.wav')];
  for (const video of videos) video.setAttribute('data-x-soundfixer-id', 'bad"], div, [id="');
  const environment = await loadContentScript('https://example.test/', videos);
  const scan = await environment.send({ action: 'scanMedia' });
  const ids = videos.map(environment.getMediaId);
  assert.equal(Object.keys(scan.media).length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.match(ids[0], /^sa-\d+$/);
  const rejected = await environment.send({ action: 'applySettings', elid: 'bad"], div, [id="', settings: { gain: 5 } });
  assert.equal(rejected.success, false);
  assert.equal(FakeAudioContext.instances, 0);
  assert.equal((await environment.send({ action: 'getAudioLevel', elid: {} })).success, false);
  await environment.send({ action: 'applySettings', elid: ids[1], settings: { gain: 2 } });
  // The selected private identity remains bound to the second element only.
  assert.equal(videos[0].xSoundFixerGain, undefined);
  assert.equal(videos[1].xSoundFixerGain.gain.value, 2);
  videos[1].setAttribute('data-x-soundfixer-id', ids[0]);
  assert.equal(environment.getMediaId(videos[1]), ids[1]);
  await environment.send({ action: 'applySettings', elid: ids[1], settings: { gain: 3 } });
  assert.equal(videos[1].xSoundFixerGain.gain.value, 3);
});

test('scanning and site disabling never write extension markers into page DOM', async () => {
  const video = new FakeMediaElement('https://example.test/a.wav');
  const environment = await loadContentScript('https://example.test/', [video]);
  await environment.send({ action: 'scanMedia' });
  await environment.send({ action: 'setSiteDisabled', disabled: true });
  assert.equal(video.attributes.size, 0);
});

test('the private registry is bounded and arbitrary page elements cannot be registered', async () => {
  const videos = Array.from({ length: 200 }, (_, index) => new FakeMediaElement(`https://example.test/${index}.wav`));
  const environment = await loadContentScript('https://example.test/', videos);
  const scan = await environment.send({ action: 'scanMedia' });
  assert.equal(Object.keys(scan.media).length, 128);
  assert.equal(environment.getMediaId(videos[128]), undefined);
  await environment.send({ action: 'applyShortcut', command: 'increase-gain' });
  assert.equal(FakeAudioContext.sources.length, 32);
  assert.equal(videos[128].xSoundFixerGain, undefined);
  environment.removeMedia(videos[0]);
  const div = new FakeMediaElement('https://example.test/fake.wav');
  div.tagName = 'DIV';
  div.setAttribute('data-x-soundfixer-id', environment.getMediaId(videos[1]));
  environment.addMedia(div);
  assert.equal(environment.getMediaId(div), undefined);
  assert.equal(div.xSoundFixerGain, undefined);
});

test('removed media releases processing nodes, rejects stale commands and reuses its playable source', async () => {
  const video = new FakeMediaElement('https://example.test/a.wav');
  const environment = await loadContentScript('https://example.test/', [video]);
  const id = environment.getMediaId(video);
  await environment.send({ action: 'applySettings', elid: id, settings: { gain: 3, mono: true, flip: true } });
  const source = video.xSoundFixerSource;
  const context = video.xSoundFixerContext;
  const processing = [video.xSoundFixerGain, video.xSoundFixerPan, video.xSoundFixerOutput,
    video.xSoundFixerAnalyser, video.xSoundFixerEqBass, video.xSoundFixerSplit, video.xSoundFixerMerge];
  environment.removeMedia(video);
  assert.deepEqual(source.connections, [context.destination]);
  assert.equal(context.state, 'running');
  assert.equal(video.xSoundFixerGain, undefined);
  assert.ok(processing.every(node => node.connections.length === 0));
  assert.equal((await environment.send({ action: 'applySettings', elid: id, settings: { gain: 5 } })).success, false);
  video.dispatch('loadedmetadata');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(video.xSoundFixerGain, undefined);
  environment.addMedia(video);
  assert.equal(environment.getMediaId(video), id);
  assert.equal(video.xSoundFixerSource, source);
  assert.equal(FakeAudioContext.sources.length, 1);
  assert.equal(FakeAudioContext.instances, 1);
  assert.equal(video.xSoundFixerGain.gain.value, 3);
  assert.equal(video.xSoundFixerOutput.channelCount, 1);
  assert.deepEqual(video.xSoundFixerMerge.connections, [video.xSoundFixerOutput]);
  assert.deepEqual(video.xSoundFixerOutput.connections, [context.destination]);
});

test('simultaneous media processing is bounded and mono remains per element', async () => {
  const videos = Array.from({ length: 40 }, (_, index) => new FakeMediaElement(`https://example.test/${index}.wav`));
  const environment = await loadContentScript('https://example.test/', videos, null, {
    globalSettingsResult: { enabled: true, settings: { gain: 2 } }
  });
  assert.equal(FakeAudioContext.instances, 1);
  assert.equal(FakeAudioContext.sources.length, 32);
  assert.equal(videos.filter(video => video.xSoundFixerGain).length, 32);
  const limited = await environment.send({ action: 'applySettings', elid: environment.getMediaId(videos[39]), settings: { gain: 4 } });
  assert.equal(limited.applied, false);
  assert.equal(limited.capability.reason, 'audio-resource-limit');
  await environment.send({ action: 'applySettings', elid: environment.getMediaId(videos[0]), settings: { mono: true } });
  assert.equal(videos[0].xSoundFixerOutput.channelCount, 1);
  assert.equal(videos[1].xSoundFixerOutput.channelCount, 2);
  assert.equal(videos[0].xSoundFixerContext.destination.channelCount, 2);
  environment.removeMedia(videos[0]);
  await environment.send({ action: 'applySettings', elid: environment.getMediaId(videos[39]), settings: { gain: 4 } });
  assert.equal(videos[39].xSoundFixerGain.gain.value, 4);
  assert.equal(FakeAudioContext.sources.length, 33);
});

test('retained detached-media churn bounds lifetime sources and coalesces notifications', async () => {
  const environment = await loadContentScript('https://example.test/', [], null, {
    globalSettingsResult: { enabled: true, settings: { gain: 2 } }
  });
  const retained = [];
  for (let index = 0; index < 100; index += 1) {
    const video = new FakeMediaElement(`https://example.test/${index}.wav`);
    retained.push(video);
    environment.addMedia(video);
    environment.removeMedia(video);
  }
  assert.equal(FakeAudioContext.instances, 1);
  assert.equal(FakeAudioContext.sources.length, 64);
  assert.ok(retained.every(video => !video.xSoundFixerGain));
  for (const video of retained.slice(0, 64)) {
    assert.deepEqual(video.xSoundFixerSource.connections, [video.xSoundFixerContext.destination]);
  }
  assert.ok(retained.slice(64).every(video => !video.xSoundFixerSource));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(environment.runtimeMessages.filter(message => message.action === 'mediaElementsChanged').length, 1);
  assert.equal(Object.keys((await environment.send({ action: 'scanMedia' })).media).length, 0);
  environment.addMedia(retained[0]);
  assert.equal(retained[0].xSoundFixerGain.gain.value, 2);
  assert.equal(FakeAudioContext.sources.length, 64);
});

test('failed or malformed exception reads block graphs until explicit site enable', async () => {
  for (const failure of [{ exceptionError: true }, { exceptionMalformed: true }]) {
    const video = new FakeMediaElement('https://example.test/a.wav');
    const environment = await loadContentScript('https://example.test/', [video], null, {
      ...failure, globalSettingsResult: { enabled: true, settings: { gain: 4 } }
    });
    const state = firstMediaEntry(await environment.send({ action: 'scanMedia' }));
    assert.equal(state.capability.mode, 'disabled');
    assert.equal(state.capability.reason, 'site-exception-unavailable');
    assert.equal(FakeAudioContext.instances, 0);
    const result = await environment.send({ action: 'applySettings', elid: environment.getMediaId(video), settings: { gain: 2 } });
    assert.equal(result.applied, false);
    assert.equal(FakeAudioContext.instances, 0);
    await environment.send({ action: 'setSiteDisabled', disabled: false });
    assert.equal(video.xSoundFixerGain.gain.value, 2);
  }
});
