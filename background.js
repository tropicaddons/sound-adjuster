'use strict';

const {
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

async function applyCommandToTab(command, tab) {
	if (!Number.isInteger(tab?.id)) return;
	const frames = await browser.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
	const results = await Promise.all(frames.map(frame => (
		browser.tabs.sendMessage(tab.id, {
			action: 'applyShortcut',
			command
		}, { frameId: frame.frameId }).catch(() => null)
	)));
	const result = results.find(candidate => candidate?.success && candidate?.settings);
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
			browser.storage.local,
			tab.url,
			tab.incognito === true
		);
		if (profileStatus?.remembered) {
			await saveSiteProfile(
				browser.storage.local,
				tab.url,
				result.settings,
				tab.incognito === true
			);
		}
	}
}

function requestContext(message, sender) {
	return {
		url: sender.tab?.url || message.tabUrl,
		incognito: sender.tab?.incognito === true || message.incognito === true
	};
}

browser.runtime.onMessage.addListener((message, sender) => {
	if (!message?.action) return undefined;
	const context = requestContext(message, sender);

	switch (message.action) {
		case 'getSiteProfile':
			return getSiteProfile(browser.storage.local, context.url, context.incognito);
		case 'saveSiteProfile':
			return saveSiteProfile(
				browser.storage.local,
				context.url,
				message.settings,
				context.incognito
			);
		case 'removeSiteProfile':
			return removeSiteProfile(browser.storage.local, context.url, context.incognito);
		case 'getNamedProfiles':
			return getNamedProfiles(browser.storage.local, context.url, context.incognito);
		case 'saveNamedProfile':
			return saveNamedProfile(
				browser.storage.local,
				context.url,
				message.name,
				message.settings,
				context.incognito
			);
		case 'removeNamedProfile':
			return removeNamedProfile(
				browser.storage.local,
				context.url,
				message.profileId,
				context.incognito
			);
		case 'getGlobalSettings':
			return getGlobalSettings(browser.storage.local, context.incognito);
		case 'saveGlobalSettings':
			return saveGlobalSettings(
				browser.storage.local,
				message.enabled,
				message.settings,
				context.incognito
			);
		case 'updateBadge':
			return updateBadge(sender.tab?.id, message.settings, message.disabled);
		case 'getSiteExceptionStatus':
			return getSiteExceptionStatus(browser.storage.local, context.url, context.incognito);
		case 'addSiteException':
			return addSiteException(browser.storage.local, context.url, context.incognito);
		case 'removeSiteException':
			return removeSiteException(browser.storage.local, context.url, context.incognito);
		case 'listSiteExceptions':
			return listSiteExceptions(browser.storage.local);
		case 'removeSiteExceptionByKey':
			return removeSiteExceptionByKey(browser.storage.local, message.siteKey);
		case 'clearSiteExceptions':
			return clearSiteExceptions(browser.storage.local);
		default:
			return undefined;
	}
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
