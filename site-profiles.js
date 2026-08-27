'use strict';

(function initializeSiteProfiles(root) {
	const PROFILE_VERSION = 1;
	const PROFILE_KEY_PREFIX = 'soundAdjuster.siteProfile.v1.';

	function normalizeSiteKey(urlValue) {
		try {
			const url = new URL(urlValue);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

			let hostname = url.hostname.toLowerCase();
			if (hostname.startsWith('www.')) hostname = hostname.slice(4);
			if (!hostname) return null;
			return url.port ? `${hostname}:${url.port}` : hostname;
		} catch (error) {
			return null;
		}
	}

	function profileStorageKey(siteKey) {
		return siteKey ? `${PROFILE_KEY_PREFIX}${siteKey}` : null;
	}

	function normalizeSettings(settings) {
		const stateApi = root.SoundAdjusterPopupState;
		if (stateApi?.normalizeSettings) return stateApi.normalizeSettings(settings);
		return { ...settings };
	}

	function ineligibleResult() {
		return {
			eligible: false,
			siteKey: null,
			remembered: false,
			profile: null
		};
	}

	async function getSiteProfile(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();

		const key = profileStorageKey(siteKey);
		const stored = await storageArea.get(key);
		const candidate = stored?.[key];
		if (!candidate || candidate.version !== PROFILE_VERSION) {
			return { eligible: true, siteKey, remembered: false, profile: null };
		}

		const profile = {
			version: PROFILE_VERSION,
			siteKey,
			settings: normalizeSettings(candidate.settings),
			updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0
		};
		return { eligible: true, siteKey, remembered: true, profile };
	}

	async function saveSiteProfile(storageArea, urlValue, settings, incognito = false, now = Date.now()) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();

		const profile = {
			version: PROFILE_VERSION,
			siteKey,
			settings: normalizeSettings(settings),
			updatedAt: now
		};
		await storageArea.set({ [profileStorageKey(siteKey)]: profile });
		return { eligible: true, siteKey, remembered: true, profile };
	}

	async function removeSiteProfile(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();

		await storageArea.remove(profileStorageKey(siteKey));
		return { eligible: true, siteKey, remembered: false, profile: null };
	}

	const api = {
		PROFILE_KEY_PREFIX,
		PROFILE_VERSION,
		getSiteProfile,
		normalizeSiteKey,
		profileStorageKey,
		removeSiteProfile,
		saveSiteProfile
	};

	root.SoundAdjusterSiteProfiles = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
