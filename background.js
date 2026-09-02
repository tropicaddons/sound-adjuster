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
