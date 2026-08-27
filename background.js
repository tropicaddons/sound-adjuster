'use strict';

const {
	getSiteProfile,
	removeSiteProfile,
	saveSiteProfile
} = globalThis.SoundAdjusterSiteProfiles;

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
		default:
			return undefined;
	}
});
