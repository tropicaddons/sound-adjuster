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
	removeSiteExceptionByKey,
	normalizeSiteKey
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

const POWER_STATE_KEY = 'soundAdjuster.power.v1';
let powerState = { eligible: false, enabled: false, revision: 0 };
let powerChangeQueue = Promise.resolve();
const playbackRecoveryTabs = new Map();
// Own application and its acknowledged Remember write in the background: closing
// the popup must not abandon either half of the operation.
const popupAudioQueues = new Map();
let popupAudioEpoch = 0;
const popupAudioDocumentEpochs = new Map();
function currentPopupAudioEpoch(epoch, tabId) {
	return !epoch.cancelled && epoch.data === popupAudioEpoch && epoch.document === (popupAudioDocumentEpochs.get(tabId) || 0);
}

function invalidateSiteAudio(url, incognito) {
	const siteKey = normalizeSiteKey(url);
	for (const queue of popupAudioQueues.values()) {
		for (const epoch of queue.epochs) {
			if (epoch.siteKey === siteKey && epoch.incognito === incognito) epoch.cancelled = true;
		}
	}
}

function queuePopupAudio(message, sender, kind) {
	const queue = popupAudioQueues.get(message.tabId) || { tail: Promise.resolve(), pending: null, epochs: new Set() };
	const epoch = { data: popupAudioEpoch, document: popupAudioDocumentEpochs.get(message.tabId) || 0,
		siteKey: normalizeSiteKey(message.tabUrl), incognito: message.incognito === true, cancelled: false };
	// Collapse only requests which have not started; in-flight delivery owns an
	// immutable settings snapshot. Merge fields so a gain drag cannot drop EQ.
	if (queue.pending && !queue.pending.epoch.cancelled && queue.pending.epoch.data === epoch.data && queue.pending.epoch.document === epoch.document && queue.pending.request.tabUrl === message.tabUrl) {
		Object.assign(queue.pending.request.settings, message.settings);
		queue.pending.request.frameIds = [...new Set([...queue.pending.request.frameIds, ...message.frameIds])].slice(0, 64);
		return queue.pending.result;
	}
	const request = { ...message, settings: { ...message.settings }, frameIds: [...message.frameIds] };
	const pending = { request, epoch };
	queue.epochs.add(epoch);
	const result = queue.tail.then(() => {
		if (queue.pending === pending) queue.pending = null;
		return dispatchRequest(request, sender, kind, epoch);
	});
	pending.result = result;
	queue.pending = pending;
	const settled = result.catch(() => {});
	queue.tail = settled;
	popupAudioQueues.set(message.tabId, queue);
	settled.then(() => {
		queue.epochs.delete(epoch);
		if (queue.tail === settled) popupAudioQueues.delete(message.tabId);
	});
	return result;
}

async function applyPopupAudio(message, context, storageArea, epoch) {
	if (!currentPopupAudioEpoch(epoch, context.tab.id) || !(await getPowerState()).enabled) return { success: false };
	const access = await effectiveSiteStatus(storageArea, context.tab.id, context.url, context.incognito);
	if (access.disabled) return { success: false };
	const profile = await getSiteProfile(storageArea, context.url, context.incognito);
	const deliver = async () => {
		const live = await browser.webNavigation.getAllFrames({ tabId: context.tab.id });
		const frames = await Promise.all(live.filter(frame => validId(frame.frameId)).slice(0, 64).map(async frame => {
			if (message.frameIds.includes(frame.frameId)) return frame;
			// A newly inserted iframe may replace a scanned player. Discover its
			// existing listener without adding a startup injection/recovery path.
			const scan = await browser.tabs.sendMessage(context.tab.id, { action: 'scanMedia' },
				{ frameId: frame.frameId }).catch(() => null);
			return scan?.success === true ? frame : null;
		}));
		return Promise.all(frames.filter(Boolean).map(async frame => {
			try {
				return await browser.tabs.sendMessage(context.tab.id,
					{ action: 'applyFrameSettings', settings: message.settings }, { frameId: frame.frameId });
			} catch (error) {
				const current = await browser.webNavigation.getAllFrames({ tabId: context.tab.id }).catch(() => null);
				if (current && !current.some(candidate => candidate.frameId === frame.frameId)) return { frameRemoved: true };
				return { success: false, applied: false, error: String(error) };
			}
		}));
	};
	let results = await deliver();
	if (results.some(result => result?.frameRemoved)) results = await deliver();
	const applied = results.find(result => result?.applied === true && validSettings(result.settings));
	const success = results.length > 0 && results.every(result => result?.success === true);
	if (!success && !applied) return { success: false, results };
	let rememberError = false;
	// Recheck after slow frame acknowledgements. A removal/clear/navigation or
	// private context change must not resurrect a forgotten profile.
	const tab = await browser.tabs.get(context.tab.id).catch(() => null);
	if (profile.remembered && applied && currentPopupAudioEpoch(epoch, context.tab.id) && tab
		&& tab.url === context.url && (tab.incognito === true) === context.incognito
		&& (await getPowerState()).enabled
		&& !(await effectiveSiteStatus(storageArea, tab.id, tab.url, context.incognito)).disabled) {
		// Reserve the shared write queue before yielding again. An OFF/remove/clear
		// request received afterwards is ordered after this write, and wins.
		if (currentPopupAudioEpoch(epoch, context.tab.id)) {
			try {
				await saveSiteProfile(storageArea, context.url, applied.settings, context.incognito);
				await notifyAudioDataChanged();
			} catch (error) {
				rememberError = true;
				console.warn('Unable to save the applied site settings:', error);
			}
		}
	}
	return { success: success || Boolean(applied), partial: !success, rememberError, results };
}

async function effectiveSiteStatus(storageArea, tabId, url, incognito) {
	const status = await getSiteExceptionStatus(storageArea, url, incognito);
	return playbackRecoveryTabs.has(tabId) ? { ...status, disabled: true, temporary: true } : status;
}
const powerStateReady = (async () => {
	try {
		const storageArea = await audioStorageReady;
		if (!storageArea) return;
		const stored = await storageArea.get(POWER_STATE_KEY);
		const saved = stored?.[POWER_STATE_KEY];
		powerState = { eligible: true, enabled: saved?.enabled !== false,
			revision: validId(saved?.revision) ? saved.revision : 0 };
	} catch (error) {
		console.warn('Unable to read Sound Adjuster power state:', error);
	}
	await browser.action.setBadgeText({ text: powerState.enabled ? '' : 'OFF' }).catch(() => {});
})();

async function getPowerState() {
	await powerStateReady;
	if (!powerState.eligible) {
		const storageArea = await audioStorageReady;
		if (storageArea) {
			try {
				const stored = await storageArea.get(POWER_STATE_KEY);
				const saved = stored?.[POWER_STATE_KEY];
				if (!powerState.eligible) {
					powerState = { eligible: true, enabled: saved?.enabled !== false,
						revision: validId(saved?.revision) ? saved.revision : 0 };
				}
			} catch (error) { console.warn('Unable to retry the power state:', error); }
		}
	}
	return { ...powerState };
}

function setPowerState(enabled) {
	const operation = powerChangeQueue.then(async () => {
		await powerStateReady;
		const storageArea = await audioStorageReady;
		if (!storageArea) return { success: false, ...powerState };
		const revision = powerState.revision + 1;
		await globalThis.SoundAdjusterStorageWrites.enqueueStorageWrite(storageArea, () => (
			storageArea.set({ [POWER_STATE_KEY]: { version: 1, enabled, revision } })
		));
		powerState = { eligible: true, enabled, revision };
		await browser.action.setBadgeText({ text: enabled ? '' : 'OFF' }).catch(() => {});
		const tabs = await browser.tabs.query({});
		let synchronized = true;
		await Promise.all(tabs.map(async tab => {
			// A tab can close after enumeration. Cosmetic badge failure must not
			// abort power delivery to the remaining tabs or its completion event.
			await updateBadge(tab.id, null, !enabled).catch(() => {});
			const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
			// Power applies to every frame, including players beyond the popup's scan limit.
			const results = await Promise.all((frames || []).filter(frame => validId(frame.frameId)).map(frame => (
				browser.tabs.sendMessage(tab.id, { action: 'setPowerEnabled', enabled, revision },
					{ frameId: frame.frameId }).catch(() => null).then(async result => {
					if (result?.success === true) return result;
					// Only confirmed, still-processed audio warrants a warning. Empty,
					// restricted or removed frames are not failed media players.
					const live = await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
					if (!live?.some(current => current.frameId === frame.frameId)) return null;
					try {
						const probe = await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame.frameId] },
							func: (enabled, revision) => typeof globalThis.soundAdjusterPowerNeedsSync === 'function'
								&& globalThis.soundAdjusterPowerNeedsSync(enabled, revision), args: [enabled, revision] });
						return probe.some(entry => entry.result === true) ? { success: false } : null;
					} catch (_) { return null; }
				})
			)));
			if (results.some(result => result && result.success !== true)) synchronized = false;
		}));
		powerState = { ...powerState, synchronized };
		await browser.runtime.sendMessage({ action: 'powerStateChanged', ...powerState, synchronized }).catch(() => {});
		return { success: true, ...powerState, synchronized };
	});
	powerChangeQueue = operation.catch(() => {});
	return operation;
}

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
	await powerStateReady;
	disabled = disabled || !powerState.enabled;
	const text = formatBadge(settings, disabled);
	await browser.action.setBadgeBackgroundColor({ tabId, color: disabled ? '#77777d' : '#ff6b35' });
	await browser.action.setBadgeText({ tabId, text });
}

async function applyCommandToTab(command, tab, targetFrameIds = null) {
	await powerChangeQueue;
	if (!(await getPowerState()).enabled) return { success: false, disabled: true };
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
	if (!result || results.some(candidate => candidate?.settings && (!candidate.success || !validSettings(candidate.settings)))
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

const CONTENT_ACTIONS = new Set(['getPowerState', 'getSiteProfile', 'getGlobalSettings', 'getSiteExceptionStatus', 'updateBadge']);
const POPUP_ACTIONS = new Set([
	'applyPopupAudio',
	'getPowerState', 'setPowerState', 'resetAudio', 'getSiteProfile', 'saveSiteProfile', 'removeSiteProfile',
	'recoverMediaPlayback',
	'getNamedProfiles', 'saveNamedProfile', 'removeNamedProfile',
	'getGlobalSettings', 'getSiteExceptionStatus', 'addSiteException', 'removeSiteException'
]);
const OPTIONS_ACTIONS = new Set([
	'getGlobalSettings', 'saveGlobalSettings', 'listSiteExceptions',
	'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'
]);
const ACTION_FIELDS = {
	applyPopupAudio: ['settings', 'frameIds'],
	setPowerState: ['enabled'],
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

async function notifySiteAccessChanged(storageArea) {
	const tabs = await browser.tabs.query({});
	await Promise.all(tabs.filter(tab => validId(tab.id) && normalizeSiteKey(tab.url)).map(async tab => {
		const status = await effectiveSiteStatus(storageArea, tab.id, tab.url, tab.incognito === true);
		if (!status.eligible) return;
		const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
		await Promise.all((frames || []).filter(frame => validId(frame.frameId)).map(frame => (
			browser.tabs.sendMessage(tab.id, { action: 'setSiteDisabled', disabled: status.disabled },
				{ frameId: frame.frameId }).catch(() => undefined)
		)));
	}));
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
	if (message.action === 'setPowerState' && typeof message.enabled !== 'boolean') return false;
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

async function dispatchRequest(message, sender, kind, audioEpoch) {
	const storageArea = await audioStorageReady;
	if (!storageArea) return invalidRequest();
	let context;
	if (kind === 'popup') {
		const tab = await browser.tabs.get(message.tabId).catch(() => null);
		const sameAudioSite = message.action === 'applyPopupAudio' && normalizeSiteKey(tab?.url)
			&& normalizeSiteKey(tab.url) === normalizeSiteKey(message.tabUrl)
			&& (tab.incognito === true) === message.incognito;
		if (!tab || tab.id !== message.tabId || ('tabUrl' in message && message.tabUrl !== tab.url && !sameAudioSite)
			|| message.action === 'applyPopupAudio' && (tab.incognito === true) !== message.incognito) return invalidRequest();
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

	// Only the affected site loses its pending Remember writes. Clearing all data
	// or changing global power invalidates every pending operation.
	if (['removeSiteProfile', 'addSiteException', 'resetAudio'].includes(message.action)) {
		invalidateSiteAudio(context.url, context.incognito);
	}
	if (message.action === 'setPowerState' || message.action === 'clearAudioData' && !context.incognito) popupAudioEpoch += 1;
	switch (message.action) {
		case 'applyPopupAudio':
			return applyPopupAudio(message, context, storageArea, audioEpoch);
		case 'getPowerState':
			return getPowerState();
		case 'setPowerState':
			return setPowerState(message.enabled);
		case 'recoverMediaPlayback': {
			const tabId = context.tab.id;
			const previous = playbackRecoveryTabs.get(tabId);
			playbackRecoveryTabs.set(tabId, { awaitingReload: true });
			try { await browser.tabs.reload(tabId); }
			catch (error) {
				if (previous) playbackRecoveryTabs.set(tabId, previous);
				else playbackRecoveryTabs.delete(tabId);
				throw error;
			}
			return { success: true };
		}
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
			return effectiveSiteStatus(storageArea, context.tab?.id ?? sender.tab?.id, context.url, context.incognito);
		case 'addSiteException':
			return addSiteException(storageArea, context.url, context.incognito);
		case 'removeSiteException':
			playbackRecoveryTabs.delete(context.tab.id);
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
	if (message.action === 'applyPopupAudio') {
		if (!Array.isArray(message.frameIds) || !message.frameIds.length) return invalidRequest();
		return queuePopupAudio(message, sender, kind);
	}
	return dispatchRequest(message, sender, kind).then(async result => {
		if (AUDIO_MUTATIONS.has(message.action) && result && result.eligible !== false && result.success !== false) {
			if (['addSiteException', 'removeSiteException', 'removeSiteExceptionByKey', 'clearSiteExceptions', 'clearAudioData'].includes(message.action)) {
				await notifySiteAccessChanged(await audioStorageReady);
			}
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
	getPowerState().then(state => browser.action.setBadgeText({ tabId, text: state.enabled ? '' : 'OFF' })).catch(() => {});
});

// A tab can emit several loading updates for one reload. Only a committed
// top-level navigation advances the one-document recovery pause.
browser.webNavigation.onCommitted?.addListener(({ tabId, frameId }) => {
	if (frameId !== 0) return;
	popupAudioDocumentEpochs.set(tabId, (popupAudioDocumentEpochs.get(tabId) || 0) + 1);
	const recovery = playbackRecoveryTabs.get(tabId);
	if (recovery?.awaitingReload) recovery.awaitingReload = false;
	else playbackRecoveryTabs.delete(tabId);
});

browser.tabs.onRemoved?.addListener(tabId => {
	playbackRecoveryTabs.delete(tabId);
	popupAudioDocumentEpochs.delete(tabId);
});
