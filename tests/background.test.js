'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scripts = [
	'popup-state.js',
	'site-profiles.js',
	'site-exceptions.js',
	'named-profiles.js',
	'global-settings.js',
	'background.js'
];

const extensionId = 'sound-adjuster@test';
const uiSender = page => ({ id: extensionId, url: `moz-extension://test/${page}.html` });
const contentSender = (overrides = {}) => ({
	id: extensionId, url: 'https://example.com/frame', frameId: 0,
	tab: { id: 7, url: 'https://example.com/watch', incognito: false }, ...overrides
});

function loadBackground(configuration = {}) {
	let runtimeListener;
	let commandListener;
	const storageValues = new Map();
	const badgeCalls = [];
	const sentMessages = [];
	const runtimeMessages = [];
	const storageCalls = [];
	const adapterFactoryCalls = [];

	const browser = {
		extension: { inIncognitoContext: configuration.backgroundIncognito === true },
		storage: {
			local: {
				async get(key) {
					storageCalls.push({ operation: 'get', key });
					if (key === null) return Object.fromEntries(storageValues);
					return storageValues.has(key) ? { [key]: storageValues.get(key) } : {};
				},
				async set(entries) {
					storageCalls.push({ operation: 'set', entries });
					for (const [key, value] of Object.entries(entries)) storageValues.set(key, value);
				},
				async remove(key) {
					storageCalls.push({ operation: 'remove', key });
					for (const entry of Array.isArray(key) ? key : [key]) storageValues.delete(entry);
				},
				...(configuration.setAccessLevel ? { setAccessLevel: configuration.setAccessLevel } : {})
			}
		},
		runtime: {
			id: extensionId,
			getURL: file => `moz-extension://test/${file}`,
			onMessage: { addListener(listener) { runtimeListener = listener; } },
			async sendMessage(message) { runtimeMessages.push(message); }
		},
		commands: { onCommand: { addListener(listener) { commandListener = listener; } } },
		tabs: {
			onUpdated: { addListener() {} },
			async get(id) {
				if (![7, 9, 12, 13, 99].includes(id)) throw new Error('Unknown tab');
				if (configuration.getTab) return configuration.getTab(id);
				if ([12, 13].includes(id)) return { id, url: uiSender('options').url, incognito: id === 13 };
				return { id, url: 'https://example.com/watch', incognito: id === 99 };
			},
			async sendMessage(tabId, message, options) {
				sentMessages.push({ tabId, message, options });
				return configuration.sendResult || {
					success: true,
					applied: true,
					settings: message.settings || { gain: 1.25, pan: 0, mono: false, flip: false }
				};
			}
		},
		webNavigation: { async getAllFrames() { return configuration.frames || [{ frameId: 0 }]; } },
		action: {
			async setBadgeBackgroundColor(details) { badgeCalls.push({ type: 'color', ...details }); },
			async setBadgeText(details) { badgeCalls.push({ type: 'text', ...details }); }
		}
	};

	// The real IndexedDB adapter has dedicated transaction/migration tests. This explicit
	// factory stub keeps background authorization tests independent of an IDB implementation.
	const indexedDB = configuration.noIndexedDB ? undefined : { open() { throw new Error('Use the adapter factory stub'); } };
	const SoundAdjusterAudioStorage = configuration.noAdapterFactory ? undefined : {
		async create(localStorage, idb) {
			adapterFactoryCalls.push({ localStorage, idb });
			if (configuration.createAdapter) return configuration.createAdapter(localStorage, idb);
			return configuration.audioAdapter || localStorage;
		}
	};
	const context = vm.createContext({ URL, browser, console, crypto, indexedDB, SoundAdjusterAudioStorage });
	for (const file of scripts) {
		vm.runInContext(
			fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
			context,
			{ filename: file }
		);
	}
	const request = (message, sender = {}) => {
		if (Object.keys(sender).length) return runtimeListener(message, sender);
		const isOptions = ['saveGlobalSettings', 'listSiteExceptions', 'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'].includes(message.action);
		return runtimeListener({ ...(isOptions ? { incognito: false } : { tabId: 9 }), ...message }, uiSender(isOptions ? 'options' : 'popup'));
	};
	return { badgeCalls, commandListener, runtimeListener: request, rawListener: runtimeListener,
		runtimeMessages, sentMessages, storageCalls, storageValues, adapterFactoryCalls };
}

test('background stores global defaults and formats the active tab badge', async () => {
	const environment = loadBackground();
	const saved = await environment.runtimeListener({
		action: 'saveGlobalSettings',
		enabled: true,
		settings: { gain: 5 }
	}, {});
	assert.equal(saved.enabled, true);
	assert.equal(saved.settings.gain, 5);
	assert.equal('extraBoost' in saved.settings, false);
	assert.equal('limiter' in saved.settings, false);

	await environment.runtimeListener({
		action: 'updateBadge',
		settings: { gain: 2, pan: 0, mono: false },
		disabled: false
	}, contentSender());
	assert.equal(environment.badgeCalls.some(call => call.type === 'text' && call.text === '2x'), true);
});

test('popup and keyboard reset use current global defaults and replace remembered site settings', async () => {
	const environment = loadBackground();
	const settings = { gain: 2, pan: -0.3, mono: true, flip: true, eqBass: 4, eqMid: -2 };
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings }, {});
	await environment.runtimeListener({ action: 'saveSiteProfile', tabUrl: 'https://example.com/watch', settings: { gain: 4 } }, {});
	const reset = await environment.runtimeListener({ action: 'resetAudio', tabId: 9 }, {});
	assert.equal(reset.success, true);
	for (const [key, value] of Object.entries(settings)) assert.equal(reset.settings[key], value);
	assert.equal(reset.settings.eqTreble, 0);
	assert.equal(environment.sentMessages[0].message.command, 'reset-audio');
	const profile = await environment.runtimeListener({ action: 'getSiteProfile', tabUrl: 'https://example.com/watch' }, {});
	assert.equal(profile.profile.settings.gain, 2);
	assert.equal(profile.profile.settings.eqBass, 4);
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 3, eqTreble: 5 } }, {});
	await environment.commandListener('reset-audio', { id: 9, url: 'https://example.com/watch' });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.sentMessages.at(-1).message.settings.gain, 3);
	assert.equal(environment.runtimeMessages.findLast(message => message.action === 'shortcutApplied').settings.eqTreble, 5);
});

test('reset ignores global defaults in private tabs and when defaults are disabled', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 3, eqBass: 8 } }, {});
	const privateReset = await environment.runtimeListener({ action: 'resetAudio', tabId: 99 }, {});
	assert.equal(privateReset.settings.gain, 1);
	assert.equal(privateReset.settings.eqBass, 0);
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: false, settings: { gain: 3, eqBass: 8 } }, {});
	const normalReset = await environment.runtimeListener({ action: 'resetAudio', tabId: 9 }, {});
	assert.equal(normalReset.settings.gain, 1);
	assert.equal(normalReset.settings.eqBass, 0);
});

test('reset reports a missing media frame and does not claim success or overwrite the remembered profile', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveSiteProfile', tabUrl: 'https://example.com/watch', settings: { gain: 4 } }, {});
	environment.runtimeMessages.length = 0;
	const reset = await environment.runtimeListener({ action: 'resetAudio', tabId: 9, frameIds: [0, 8] }, {});
	assert.equal(reset.success, false);
	assert.equal(environment.runtimeMessages.length, 0);
	const profile = await environment.runtimeListener({ action: 'getSiteProfile', tabUrl: 'https://example.com/watch' }, {});
	assert.equal(profile.profile.settings.gain, 4);
});

test('keyboard commands are forwarded to every frame in the active tab', async () => {
	const environment = loadBackground();
	environment.commandListener('increase-gain', {
		id: 9,
		url: 'https://example.com/watch',
		incognito: false
	});
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.sentMessages[0].tabId, 9);
	assert.equal(environment.sentMessages[0].message.action, 'applyShortcut');
	assert.equal(environment.sentMessages[0].message.command, 'increase-gain');
	assert.equal(environment.sentMessages[0].options.frameId, 0);
	assert.equal(environment.badgeCalls.some(call => call.type === 'text' && call.text === '1.3x'), true);
	assert.deepEqual(
		JSON.parse(JSON.stringify(environment.runtimeMessages[0])),
		{
			action: 'shortcutApplied',
			tabId: 9,
			settings: { gain: 1.25, pan: 0, mono: false, flip: false }
		}
	);
});

test('runtime sender identity and exact extension page URLs are required', async () => {
	const environment = loadBackground();
	const message = { action: 'saveGlobalSettings', incognito: false, enabled: true, settings: { gain: 4 } };
	for (const sender of [
		{}, { url: uiSender('options').url }, { ...uiSender('options'), id: 'other-extension' },
		{ ...uiSender('options'), url: `${uiSender('options').url}?spoof=1` },
		{ ...uiSender('options'), url: 'https://example.com/options.html' },
		{ ...uiSender('options'), tab: { id: 7 }, frameId: 0 },
		{ ...uiSender('options'), url: 'moz-extension://test/background.html' }
	]) {
		const result = await environment.rawListener(message, sender);
		assert.equal(result?.success === true, false);
	}
	assert.equal(environment.storageCalls.length, 0);
	const accepted = await environment.rawListener(message, uiSender('options'));
	assert.equal(accepted.enabled, true);
});

test('content scripts cannot call any privileged profile, reset, global or exception action', async () => {
	const environment = loadBackground();
	const actions = [
		'resetAudio', 'saveSiteProfile', 'removeSiteProfile', 'getNamedProfiles', 'saveNamedProfile',
		'removeNamedProfile', 'saveGlobalSettings', 'addSiteException', 'removeSiteException',
		'listSiteExceptions', 'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'
	];
	for (const action of actions) {
		await environment.rawListener({ action, settings: { gain: 4 }, incognito: false, tabId: 9,
			name: 'Injected', profileId: 'profile', siteKey: 'example.com', enabled: true }, contentSender());
	}
	assert.equal(environment.storageCalls.length, 0);
	assert.equal(environment.sentMessages.length, 0);
	assert.equal(environment.badgeCalls.length, 0);
});

test('content reads use only the browser parent-tab site and private status, including child frames', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 4 } });
	const profile = await environment.rawListener({ action: 'getSiteProfile' }, contentSender({ frameId: 8,
		url: 'https://other.example/frame' }));
	assert.equal(profile.profile.settings.gain, 4);
	const calls = environment.storageCalls.length;
	for (const message of [
		{ action: 'getSiteProfile', tabUrl: 'https://example.com/watch' },
		{ action: 'getGlobalSettings', incognito: false },
		{ action: 'getSiteExceptionStatus', tabId: 9 }
	]) {
		assert.equal((await environment.rawListener(message, contentSender())).success, false);
	}
	for (const frameId of [undefined, -1, 0.5, '0']) {
		assert.equal((await environment.rawListener({ action: 'getSiteProfile' }, contentSender({ frameId }))).success, false);
	}
	const privateSender = contentSender({ tab: { id: 99, url: 'https://example.com/watch', incognito: true } });
	for (const action of ['getSiteProfile', 'getGlobalSettings', 'getSiteExceptionStatus']) {
		const result = await environment.rawListener({ action }, privateSender);
		assert.equal(result.eligible, false);
	}
	assert.equal(environment.storageCalls.length, calls);
});

test('popup context is fetched from the browser; spoofed URL and private flags cannot access another site', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 4 } });
	const calls = environment.storageCalls.length;
	for (const message of [
		{ action: 'getSiteProfile', tabId: 111 },
		{ action: 'getSiteProfile', tabId: -1 },
		{ action: 'getSiteProfile', tabId: '9' },
		{ action: 'getSiteProfile', tabId: 9, tabUrl: 'https://spoof.example/watch' },
		{ action: 'getSiteProfile' }
	]) {
		assert.equal((await environment.rawListener(message, uiSender('popup'))).success, false);
	}
	const privateResult = await environment.rawListener({ action: 'getSiteProfile', tabId: 99, incognito: false }, uiSender('popup'));
	assert.equal(privateResult.eligible, false);
	assert.equal(environment.storageCalls.length, calls);
	const normalResult = await environment.rawListener({ action: 'getSiteProfile', tabId: 9 }, uiSender('popup'));
	assert.equal(normalResult.profile.settings.gain, 4);
});

test('private options never read or modify normal persisted audio data, and missing context fails closed', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 4 } });
	const calls = environment.storageCalls.length;
	for (const action of ['getGlobalSettings', 'saveGlobalSettings', 'listSiteExceptions',
		'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData']) {
		const payload = action === 'saveGlobalSettings' ? { enabled: true, settings: { gain: 2 } }
			: action === 'removeSiteExceptionByKey' ? { siteKey: 'example.com' } : {};
		const result = await environment.rawListener({ action, incognito: true, ...payload }, uiSender('options'));
		assert.equal(result.eligible, false);
		const missingContext = await environment.rawListener({ action, ...payload }, uiSender('options'));
		assert.equal(missingContext.success, false);
	}
	assert.equal(environment.storageCalls.length, calls);
	const current = await environment.runtimeListener({ action: 'getGlobalSettings' });
	assert.equal(current.settings.gain, 4);
});

test('schemas reject malformed settings, oversized names, and unsafe frame targets before side effects', async () => {
	const environment = loadBackground();
	for (const settings of [null, [], { gain: '2' }, { gain: Infinity }, { gain: 6 }, { pan: -2 },
		{ mono: 1 }, { flip: 'true' }, { eqBass: 21 }, { unknown: true }, { extraBoost: true }]) {
		assert.equal((await environment.runtimeListener({ action: 'saveSiteProfile', settings })).success, false);
	}
	for (const frameIds of [null, '0', [0, 0], [-1], [0.5], ['0'], Array.from({ length: 65 }, (_, id) => id)]) {
		assert.equal((await environment.runtimeListener({ action: 'resetAudio', frameIds })).success, false);
	}
	for (const name of ['', ' '.repeat(5), 'a'.repeat(33), 4]) {
		assert.equal((await environment.runtimeListener({ action: 'saveNamedProfile', name, settings: { gain: 2 } })).success, false);
	}
	for (const profileId of ['', 'p'.repeat(129), 2]) {
		assert.equal((await environment.runtimeListener({ action: 'removeNamedProfile', profileId })).success, false);
	}
	assert.equal((await environment.runtimeListener({ action: 'saveSiteProfile', settings: {}, unexpected: true })).success, false);
	assert.equal(environment.storageCalls.length, 0);
	assert.equal(environment.sentMessages.length, 0);
});

test('reset refuses to persist or announce settings after the target navigates', async () => {
	let count = 0;
	const environment = loadBackground({ getTab: id => ({ id, incognito: false,
		url: ++count === 1 ? 'https://example.com/watch' : 'https://other.example/watch' }) });
	const result = await environment.runtimeListener({ action: 'resetAudio' });
	assert.equal(result.success, false);
	assert.equal(environment.runtimeMessages.length, 0);
	assert.equal(environment.storageCalls.some(call => call.operation === 'set'), false);
});

test('invalid frame responses cannot become a stored remembered profile', async () => {
	const environment = loadBackground({ sendResult: { success: true, applied: true, settings: { gain: 100 } } });
	await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 4 } });
	const result = await environment.runtimeListener({ action: 'resetAudio' });
	assert.equal(result.success, false);
	const profile = await environment.runtimeListener({ action: 'getSiteProfile' });
	assert.equal(profile.profile.settings.gain, 4);
});

test('storage access restriction finishes before reads and writes, while listeners register immediately', async () => {
	let resolveAccess;
	let details;
	const environment = loadBackground({ setAccessLevel: value => {
		details = value;
		return new Promise(resolve => { resolveAccess = resolve; });
	} });
	assert.equal(typeof environment.rawListener, 'function');
	assert.equal(details.accessLevel, 'TRUSTED_CONTEXTS');
	const operation = environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.storageCalls.length, 0);
	resolveAccess();
	assert.equal((await operation).enabled, true);
	assert.equal(environment.storageCalls.some(call => call.operation === 'set'), true);
});

test('a failed storage access restriction fails closed for messages and keyboard operations', async () => {
	const environment = loadBackground({ setAccessLevel: async () => { throw new Error('Denied'); } });
	assert.equal((await environment.runtimeListener({ action: 'getGlobalSettings' })).success, false);
	assert.equal((await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } })).success, false);
	await environment.commandListener('reset-audio', { id: 9, url: 'https://example.com/watch' });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.storageCalls.length, 0);
	assert.equal(environment.sentMessages.length, 0);
});

test('trusted normal options can erase audio data without clearing unrelated preferences', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } });
	await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 3 } });
	await environment.runtimeListener({ action: 'saveNamedProfile', name: 'Music', settings: { gain: 1.5 } });
	await environment.runtimeListener({ action: 'addSiteException' });
	environment.storageValues.set('soundAdjusterEqualizerExpanded', true);
	environment.storageValues.set('otherExtensionPreference', 'preserve');
	const result = await environment.runtimeListener({ action: 'clearAudioData' });
	assert.equal(result.eligible, true);
	assert.equal(result.removed, 4);
	assert.equal(environment.storageValues.size, 2);
	assert.equal(environment.storageValues.get('soundAdjusterEqualizerExpanded'), true);
	assert.equal(environment.storageValues.get('otherExtensionPreference'), 'preserve');
});

test('an independently private extension process blocks options data even with a false UI flag', async () => {
	const environment = loadBackground({ backgroundIncognito: true });
	const result = await environment.rawListener({ action: 'getGlobalSettings', incognito: false }, uiSender('options'));
	assert.equal(result.eligible, false);
	await environment.rawListener({ action: 'clearAudioData', incognito: false }, uiSender('options'));
	assert.equal(environment.storageCalls.length, 0);
});

test('Firefox audio operations use only the isolated adapter, never raw local storage', async () => {
	const isolatedValues = new Map();
	const audioAdapter = {
		async get(key) { return key === null ? Object.fromEntries(isolatedValues) : { [key]: isolatedValues.get(key) }; },
		async set(entries) { for (const [key, value] of Object.entries(entries)) isolatedValues.set(key, value); },
		async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) isolatedValues.delete(key); }
	};
	const environment = loadBackground({ audioAdapter });
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } });
	await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 3 } });
	await environment.runtimeListener({ action: 'saveNamedProfile', name: 'Music', settings: { gain: 1.5 } });
	await environment.runtimeListener({ action: 'addSiteException' });
	assert.equal((await environment.runtimeListener({ action: 'getGlobalSettings' })).settings.gain, 2);
	assert.equal((await environment.runtimeListener({ action: 'getSiteProfile' })).profile.settings.gain, 3);
	assert.equal((await environment.runtimeListener({ action: 'getNamedProfiles' })).profiles[0].name, 'Music');
	assert.equal((await environment.runtimeListener({ action: 'getSiteExceptionStatus' })).disabled, true);
	const reset = await environment.runtimeListener({ action: 'resetAudio' });
	assert.equal(reset.settings.gain, 2);
	assert.equal((await environment.runtimeListener({ action: 'getSiteProfile' })).profile.settings.gain, 2);
	await environment.runtimeListener({ action: 'clearAudioData' });
	assert.equal(isolatedValues.size, 0);
	assert.equal(environment.storageCalls.length, 0);
	assert.equal(environment.adapterFactoryCalls.length, 1);
});

test('Firefox messages and commands wait for isolated storage readiness', async () => {
	let finishAdapter;
	const environment = loadBackground({ createAdapter: localStorage => new Promise(resolve => {
		finishAdapter = () => resolve(localStorage);
	}) });
	const operation = environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.storageCalls.length, 0);
	assert.equal(typeof environment.rawListener, 'function');
	finishAdapter();
	assert.equal((await operation).enabled, true);
});

test('Firefox storage initialization failures never fall back to exposed local storage', async () => {
	for (const configuration of [
		{ noAdapterFactory: true }, { noIndexedDB: true },
		{ createAdapter: async () => { throw new Error('IDB initialization failed'); } },
		{ createAdapter: async () => ({ get() {} }) }
	]) {
		const environment = loadBackground(configuration);
		assert.equal((await environment.runtimeListener({ action: 'getGlobalSettings' })).success, false);
		assert.equal((await environment.runtimeListener({ action: 'saveSiteProfile', settings: { gain: 2 } })).success, false);
		await environment.commandListener('reset-audio', { id: 9, url: 'https://example.com/watch' });
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(environment.storageCalls.length, 0);
		assert.equal(environment.sentMessages.length, 0);
	}
});

test('Chrome uses restricted local storage without opening a Firefox adapter', async () => {
	const environment = loadBackground({ noIndexedDB: true, noAdapterFactory: true, setAccessLevel: async () => {} });
	assert.equal((await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } })).enabled, true);
	assert.equal(environment.adapterFactoryCalls.length, 0);
	assert.equal(environment.storageCalls.some(call => call.operation === 'set'), true);
});

test('shortcut broadcasting is capped at 64 browser-reported frames', async () => {
	const environment = loadBackground({ frames: Array.from({ length: 1000 }, (_, frameId) => ({ frameId })) });
	await environment.commandListener('increase-gain', { id: 9, url: 'https://example.com/watch' });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(environment.sentMessages.length, 64);
	assert.equal(environment.sentMessages.at(-1).options.frameId, 63);
	const calls = environment.sentMessages.length;
	const tooMany = await environment.runtimeListener({ action: 'resetAudio', frameIds: Array.from({ length: 65 }, (_, id) => id) });
	assert.equal(tooMany.success, false);
	assert.equal(environment.sentMessages.length, calls);
});

test('successful audio mutations emit a value-free change event; denied and private requests do not', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 2 } });
	assert.deepEqual(JSON.parse(JSON.stringify(environment.runtimeMessages)), [{ action: 'audioDataChanged' }]);
	await environment.runtimeListener({ action: 'getGlobalSettings' });
	await environment.rawListener({ action: 'saveGlobalSettings', incognito: true, enabled: true, settings: { gain: 3 } }, uiSender('options'));
	await environment.rawListener({ action: 'saveSiteProfile', settings: { gain: 4 } }, contentSender());
	assert.equal(environment.runtimeMessages.length, 1);
	await environment.runtimeListener({ action: 'clearAudioData' });
	assert.deepEqual(JSON.parse(JSON.stringify(environment.runtimeMessages[1])), { action: 'audioDataChanged' });
});

test('top-level options pages hosted in extension tabs are authenticated and can save defaults', async () => {
	const environment = loadBackground();
	const sender = { ...uiSender('options'), tab: { id: 12 }, frameId: 0 };
	const result = await environment.rawListener({ action: 'saveGlobalSettings', incognito: false,
		enabled: true, settings: { gain: 2.5 } }, sender);
	assert.equal(result.enabled, true);
	assert.equal((await environment.rawListener({ action: 'getGlobalSettings', incognito: false }, sender)).settings.gain, 2.5);
});

test('options tabs reject mismatched URLs, nonexistent tabs, and embedded-frame contexts', async () => {
	const environment = loadBackground();
	for (const sender of [
		{ ...uiSender('options'), tab: { id: 7 }, frameId: 0 },
		{ ...uiSender('options'), tab: { id: 111 }, frameId: 0 },
		{ ...uiSender('options'), tab: { id: 12 }, frameId: 1 },
		{ ...uiSender('options'), tab: { id: 12 } },
		{ ...uiSender('options'), tab: { id: '12' }, frameId: 0 }
	]) {
		const result = await environment.rawListener({ action: 'saveGlobalSettings', incognito: false,
			enabled: true, settings: { gain: 4 } }, sender);
		assert.equal(result?.success, false);
	}
	assert.equal(environment.storageCalls.length, 0);
});

test('private options tab metadata overrides a spoofed false incognito payload', async () => {
	const environment = loadBackground();
	await environment.runtimeListener({ action: 'saveGlobalSettings', enabled: true, settings: { gain: 4 } });
	const calls = environment.storageCalls.length;
	const sender = { ...uiSender('options'), tab: { id: 13, incognito: false }, frameId: 0 };
	const read = await environment.rawListener({ action: 'getGlobalSettings', incognito: false }, sender);
	assert.equal(read.eligible, false);
	const save = await environment.rawListener({ action: 'saveGlobalSettings', incognito: false,
		enabled: true, settings: { gain: 2 } }, sender);
	assert.equal(save.eligible, false);
	await environment.rawListener({ action: 'clearAudioData', incognito: false }, sender);
	assert.equal(environment.storageCalls.length, calls);
	assert.equal((await environment.runtimeListener({ action: 'getGlobalSettings' })).settings.gain, 4);
});

test('exact options page sender remains valid if browser omits URL from its tab object', async () => {
	const environment = loadBackground({ getTab: id => ({ id, incognito: false }) });
	const sender = { ...uiSender('options'), tab: { id: 12 }, frameId: 0 };
	const result = await environment.rawListener({ action: 'saveGlobalSettings', incognito: false,
		enabled: true, settings: { gain: 2 } }, sender);
	assert.equal(result.enabled, true);
});
