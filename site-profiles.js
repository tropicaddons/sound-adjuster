'use strict';

(function initializeSiteProfiles(root) {
	const PROFILE_VERSION = 1;
	const PROFILE_KEY_PREFIX = 'soundAdjuster.siteProfile.v1.';
	// The background is the sole audio-state writer. All profile modules share this
	// queue so read/modify/write and bulk deletion are ordered across UI requests.
	const writeQueues = new WeakMap();
	function enqueueStorageWrite(storageArea, operation) {
		const previous = writeQueues.get(storageArea) || Promise.resolve();
		const result = previous.then(operation);
		const settled = result.catch(() => {});
		writeQueues.set(storageArea, settled);
		settled.then(() => {
			if (writeQueues.get(storageArea) === settled) writeQueues.delete(storageArea);
		});
		return result;
	}
	root.SoundAdjusterStorageWrites = { enqueueStorageWrite };

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
		return enqueueStorageWrite(storageArea, async () => {
			await storageArea.set({ [profileStorageKey(siteKey)]: profile });
			return { eligible: true, siteKey, remembered: true, profile };
		});
	}

	async function removeSiteProfile(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();

		return enqueueStorageWrite(storageArea, async () => {
			await storageArea.remove(profileStorageKey(siteKey));
			return { eligible: true, siteKey, remembered: false, profile: null };
		});
	}

	async function clearAllSiteProfiles(storageArea, incognito = false) {
		if (!storageArea || incognito) return { eligible: false, removed: 0 };
		return enqueueStorageWrite(storageArea, async () => {
			const stored = await storageArea.get(null);
			const keys = Object.keys(stored || {}).filter(key => key.startsWith(PROFILE_KEY_PREFIX));
			if (keys.length) await storageArea.remove(keys);
			return { eligible: true, removed: keys.length };
		});
	}

	async function clearAllAudioData(storageArea, incognito = false) {
		if (!storageArea || incognito) return { eligible: false, removed: 0 };
		return enqueueStorageWrite(storageArea, async () => {
			const stored = await storageArea.get(null);
			const keys = Object.keys(stored || {}).filter(key => (
				key.startsWith(PROFILE_KEY_PREFIX)
				|| key.startsWith('soundAdjuster.namedProfiles.v1.')
				|| key === 'soundAdjuster.siteExceptions.v1'
				|| key === 'soundAdjuster.globalSettings.v1'
			));
			if (keys.length) await storageArea.remove(keys);
			return { eligible: true, removed: keys.length };
		});
	}

	const api = {
		PROFILE_KEY_PREFIX,
		PROFILE_VERSION,
		clearAllAudioData,
		clearAllSiteProfiles,
		getSiteProfile,
		normalizeSiteKey,
		profileStorageKey,
		removeSiteProfile,
		saveSiteProfile
	};

	root.SoundAdjusterSiteProfiles = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
