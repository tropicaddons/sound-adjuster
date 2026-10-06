'use strict';

const {
	clearAllAudioData,
	getSiteProfile,
	removeSiteProfile,
	saveSiteProfile
} = globalThis.SoundAdjusterSiteProfiles;
const {
	addSiteException,
	clearSiteExceptions,
	getSiteExceptionStatus,
	listSiteExceptions,
	removeSiteException,
	removeSiteExceptionByKey
} = globalThis.SoundAdjusterSiteExceptions;
const {
	getNamedProfiles,
	removeNamedProfile,
	saveNamedProfile
} = globalThis.SoundAdjusterNamedProfiles;
const {
	getGlobalSettings,
	saveGlobalSettings
} = globalThis.SoundAdjusterGlobalSettings;

// Keep persisted audio data outside content-script storage access on both platforms.
// Chrome restricts local storage; Firefox uses an extension-origin IndexedDB adapter.
// Resolve failures to null so startup cannot create an unhandled rejection or fall back unsafely.
const audioStorageReady = (async () => {
	try {
		if (typeof browser.storage.local.setAccessLevel === 'function') {
			await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
			return browser.storage.local;
		}
		if (typeof globalThis.SoundAdjusterAudioStorage?.create !== 'function'
			|| typeof globalThis.indexedDB?.open !== 'function') return null;
		const storageArea = await globalThis.SoundAdjusterAudioStorage.create(browser.storage.local, globalThis.indexedDB);
		return storageArea && ['get', 'set', 'remove'].every(name => typeof storageArea[name] === 'function')
			? storageArea : null;
	} catch (error) {
		console.warn('Unable to restrict Sound Adjuster storage access:', error);
		return null;
	}
})();

function formatBadge(settings, disabled = false) {
	if (disabled) return 'OFF';
	if (settings?.mono === true) return 'M';
	const pan = Number.parseFloat(settings?.pan);
	if (Number.isFinite(pan) && Math.abs(pan) >= 0.5) return pan < 0 ? 'L' : 'R';
	const gain = Number.parseFloat(settings?.gain);
	if (Number.isFinite(gain) && Math.abs(gain - 1) >= 0.01) {
		return `${gain.toFixed(gain < 10 && gain % 1 ? 1 : 0)}x`;
	}
	return '';
}

async function updateBadge(tabId, settings, disabled = false) {
	if (!Number.isInteger(tabId)) return;
	const text = formatBadge(settings, disabled);
	await browser.action.setBadgeBackgroundColor({ tabId, color: disabled ? '#77777d' : '#ff6b35' });
	await browser.action.setBadgeText({ tabId, text });
}

async function applyCommandToTab(command, tab, targetFrameIds = null) {
	const storageArea = await audioStorageReady;
	if (!storageArea) return { success: false };
	if (!validId(tab?.id)) return { success: false };
	if (targetFrameIds && targetFrameIds.length > 64) return { success: false };
	let resetSettings;
	if (command === 'reset-audio') {
		const defaults = await getGlobalSettings(storageArea, tab.incognito === true);
		resetSettings = defaults.enabled ? defaults.settings
			: { ...globalThis.SoundAdjusterPopupState.DEFAULT_SETTINGS };
	}
	const frames = (await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []))
		.filter(frame => validId(frame.frameId)).slice(0, 64);
	const targetFrames = targetFrameIds ? frames.filter(frame => targetFrameIds.includes(frame.frameId)) : frames;
	const results = await Promise.all(targetFrames.map(frame => (
		browser.tabs.sendMessage(tab.id, {
			action: 'applyShortcut',
			command,
			...(resetSettings ? { settings: resetSettings } : {})
		}, { frameId: frame.frameId }).catch(() => null)
	)));
	const result = results.find(candidate => candidate?.success && candidate?.applied !== false && validSettings(candidate?.settings));
	if (!result || results.some(candidate => candidate?.settings && (!candidate.success || candidate.applied === false || !validSettings(candidate.settings)))
		|| targetFrameIds && (targetFrames.length !== targetFrameIds.length || results.some(candidate => !candidate?.success))) {
		return { success: false };
	}
	// A navigation while frames were responding must not save old audio state for the new page.
	const currentTab = await browser.tabs.get(tab.id).catch(() => null);
	if (!currentTab || currentTab.url !== tab.url || (currentTab.incognito === true) !== (tab.incognito === true)) {
		return { success: false };
	}
	if (result) {
		await updateBadge(tab.id, result.settings, false);
		await browser.runtime.sendMessage({
			action: 'shortcutApplied',
			tabId: tab.id,
			settings: result.settings
		}).catch(() => {
			// The popup is usually closed; no listener is a normal condition.
		});
		const profileStatus = await getSiteProfile(
			storageArea,
			tab.url,
			tab.incognito === true
		);
		if (profileStatus?.remembered) {
			await saveSiteProfile(
				storageArea,
				tab.url,
				result.settings,
				tab.incognito === true
			);
			await notifyAudioDataChanged();
		}
	}
	return { success: true, settings: result.settings };
}

const CONTENT_ACTIONS = new Set(['getSiteProfile', 'getGlobalSettings', 'getSiteExceptionStatus', 'updateBadge']);
const POPUP_ACTIONS = new Set([
	'resetAudio', 'getSiteProfile', 'saveSiteProfile', 'removeSiteProfile',
	'getNamedProfiles', 'saveNamedProfile', 'removeNamedProfile',
	'getGlobalSettings', 'getSiteExceptionStatus', 'addSiteException', 'removeSiteException'
]);
const OPTIONS_ACTIONS = new Set([
	'getGlobalSettings', 'saveGlobalSettings', 'listSiteExceptions',
	'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'
]);
const ACTION_FIELDS = {
	resetAudio: ['frameIds'], saveSiteProfile: ['settings'],
	saveNamedProfile: ['name', 'settings'], removeNamedProfile: ['profileId'],
	saveGlobalSettings: ['enabled', 'settings'], updateBadge: ['settings', 'disabled'],
	removeSiteExceptionByKey: ['siteKey']
};
const AUDIO_MUTATIONS = new Set([
	'saveSiteProfile', 'removeSiteProfile', 'saveNamedProfile', 'removeNamedProfile',
	'saveGlobalSettings', 'addSiteException', 'removeSiteException',
	'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'
]);

async function notifyAudioDataChanged() {
	await browser.runtime.sendMessage({ action: 'audioDataChanged' }).catch(() => {});
}

function validId(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

function validSettings(settings) {
	if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
	const defaults = globalThis.SoundAdjusterPopupState.DEFAULT_SETTINGS;
	const ranges = { gain: [0, 5], pan: [-1, 1] };
	return Object.keys(settings).every(key => {
		if (!Object.hasOwn(defaults, key)) return false;
		if (key === 'mono' || key === 'flip') return typeof settings[key] === 'boolean';
		const range = ranges[key] || [-20, 20];
		return typeof settings[key] === 'number' && Number.isFinite(settings[key])
			&& settings[key] >= range[0] && settings[key] <= range[1];
	});
}

function validMessage(message, kind) {
	const allowed = new Set(['action', ...(ACTION_FIELDS[message.action] || []),
		...(kind === 'popup' ? ['tabId', 'tabUrl', 'incognito'] : kind === 'options' ? ['incognito'] : [])]);
	if (Object.keys(message).some(key => !allowed.has(key))) return false;
	if ('incognito' in message && typeof message.incognito !== 'boolean') return false;
	if (kind === 'options' && typeof message.incognito !== 'boolean') return false;
	if (kind === 'popup' && !validId(message.tabId)) return false;
	if ('tabUrl' in message && (typeof message.tabUrl !== 'string' || message.tabUrl.length > 8192)) return false;
	if ((ACTION_FIELDS[message.action] || []).includes('settings') && !validSettings(message.settings)) return false;
	if (message.action === 'saveGlobalSettings' && typeof message.enabled !== 'boolean') return false;
	if (message.action === 'updateBadge' && typeof message.disabled !== 'boolean') return false;
	if ('frameIds' in message && (!Array.isArray(message.frameIds) || message.frameIds.length > 64
		|| !message.frameIds.every(validId) || new Set(message.frameIds).size !== message.frameIds.length)) return false;
	if (message.action === 'saveNamedProfile' && (typeof message.name !== 'string'
		|| !message.name.trim() || message.name.length > 32)) return false;
	if (message.action === 'removeNamedProfile' && (typeof message.profileId !== 'string'
		|| !message.profileId || message.profileId.length > 128)) return false;
	if (message.action === 'removeSiteExceptionByKey' && (typeof message.siteKey !== 'string'
		|| !message.siteKey || message.siteKey.length > 512)) return false;
	return true;
}

async function dispatchRequest(message, sender, kind) {
	const storageArea = await audioStorageReady;
	if (!storageArea) return invalidRequest();
	let context;
	if (kind === 'popup') {
		const tab = await browser.tabs.get(message.tabId).catch(() => null);
		if (!tab || tab.id !== message.tabId || ('tabUrl' in message && message.tabUrl !== tab.url)) return invalidRequest();
		context = { url: tab.url, incognito: tab.incognito === true, tab };
	} else if (kind === 'content') {
		// Child frames inherit the top-level tab's site policy, never a URL from the payload.
		context = { url: sender.tab.url, incognito: sender.tab.incognito === true };
	} else {
		const optionsTab = sender.tab ? await browser.tabs.get(sender.tab.id).catch(() => null) : null;
		if (sender.tab && (!optionsTab || optionsTab.id !== sender.tab.id
			|| typeof optionsTab.url === 'string' && optionsTab.url !== browser.runtime.getURL('options.html'))) return invalidRequest();
		// Browsers attach tab metadata to options_ui.open_in_tab pages. A sender URL is
		// browser-provided; missing tab URL permission does not invalidate this exact page identity.
		context = { incognito: optionsTab?.incognito === true || message.incognito === true
			|| browser.extension?.inIncognitoContext === true };
	}
	if (kind === 'options' && context.incognito) {
		if (message.action === 'getGlobalSettings') return getGlobalSettings(storageArea, true);
		return { eligible: false, sites: [], success: false };
	}

	switch (message.action) {
		case 'resetAudio':
			return applyCommandToTab('reset-audio', context.tab, message.frameIds);
		case 'getSiteProfile':
			return getSiteProfile(storageArea, context.url, context.incognito);
		case 'saveSiteProfile':
			return saveSiteProfile(
				storageArea,
				context.url,
				message.settings,
				context.incognito
			);
		case 'removeSiteProfile':
			return removeSiteProfile(storageArea, context.url, context.incognito);
		case 'getNamedProfiles':
			return getNamedProfiles(storageArea, context.url, context.incognito);
		case 'saveNamedProfile':
			return saveNamedProfile(
				storageArea,
				context.url,
				message.name,
				message.settings,
				context.incognito
			);
		case 'removeNamedProfile':
			return removeNamedProfile(
				storageArea,
				context.url,
				message.profileId,
				context.incognito
			);
		case 'getGlobalSettings':
			return getGlobalSettings(storageArea, context.incognito);
		case 'saveGlobalSettings':
			return saveGlobalSettings(
				storageArea,
				message.enabled,
				message.settings,
				context.incognito
			);
		case 'updateBadge':
			return updateBadge(sender.tab?.id, message.settings, message.disabled);
		case 'getSiteExceptionStatus':
			return getSiteExceptionStatus(storageArea, context.url, context.incognito);
		case 'addSiteException':
			return addSiteException(storageArea, context.url, context.incognito);
		case 'removeSiteException':
			return removeSiteException(storageArea, context.url, context.incognito);
		case 'listSiteExceptions':
			return listSiteExceptions(storageArea);
		case 'removeSiteExceptionByKey':
			return removeSiteExceptionByKey(storageArea, message.siteKey);
		case 'clearSiteExceptions':
			return clearSiteExceptions(storageArea);
		case 'clearAudioData':
			return clearAllAudioData(storageArea, context.incognito);
		default:
			return undefined;
	}
}

function invalidRequest() {
	return { success: false, error: 'Invalid or unauthorized request' };
}

browser.runtime.onMessage.addListener((message, sender) => {
	if (!message || typeof message !== 'object' || Array.isArray(message)
		|| typeof message.action !== 'string' || sender?.id !== browser.runtime.id) return invalidRequest();
	let kind;
	if (!sender.tab && sender.url === browser.runtime.getURL('popup.html')) kind = 'popup';
	else if (sender.url === browser.runtime.getURL('options.html')) {
		if (sender.tab && (!validId(sender.tab.id) || sender.frameId !== 0)) return invalidRequest();
		kind = 'options';
	}
	else if (validId(sender.tab?.id) && validId(sender.frameId)) kind = 'content';
	else return invalidRequest();
	const actions = kind === 'popup' ? POPUP_ACTIONS : kind === 'options' ? OPTIONS_ACTIONS : CONTENT_ACTIONS;
	if (!actions.has(message.action)) return undefined;
	if (!validMessage(message, kind)) return invalidRequest();
	return dispatchRequest(message, sender, kind).then(async result => {
		if (AUDIO_MUTATIONS.has(message.action) && result && result.eligible !== false && result.success !== false) {
			await notifyAudioDataChanged();
		}
		return result;
	});
});

browser.commands.onCommand.addListener((command, tab) => {
	applyCommandToTab(command, tab).catch(error => {
		console.warn('Unable to apply the Sound Adjuster shortcut:', error);
	});
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status !== 'loading') return;
	browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});
