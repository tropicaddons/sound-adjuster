'use strict';

(function initializeGlobalSettings(root) {
	const GLOBAL_SETTINGS_KEY = 'soundAdjuster.globalSettings.v1';
	const GLOBAL_SETTINGS_VERSION = 1;

	function normalizeSettings(settings) {
		const stateApi = root.SoundAdjusterPopupState;
		if (stateApi?.normalizeSettings) return stateApi.normalizeSettings(settings);
		return { ...settings };
	}

	function unavailableResult() {
		return { eligible: false, enabled: false, settings: null, updatedAt: 0 };
	}

	async function getGlobalSettings(storageArea, incognito = false) {
		if (!storageArea || incognito) return unavailableResult();
		const stored = await storageArea.get(GLOBAL_SETTINGS_KEY);
		const candidate = stored?.[GLOBAL_SETTINGS_KEY];
		if (!candidate || candidate.version !== GLOBAL_SETTINGS_VERSION) {
			return { eligible: true, enabled: false, settings: normalizeSettings({}), updatedAt: 0 };
		}
		return {
			eligible: true,
			enabled: candidate.enabled === true,
			settings: normalizeSettings(candidate.settings),
			updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0
		};
	}

	async function saveGlobalSettings(
		storageArea,
		enabled,
		settings,
		incognito = false,
		now = Date.now()
	) {
		if (!storageArea || incognito) return unavailableResult();
		const value = {
			version: GLOBAL_SETTINGS_VERSION,
			enabled: enabled === true,
			settings: normalizeSettings(settings),
			updatedAt: now
		};
		await storageArea.set({ [GLOBAL_SETTINGS_KEY]: value });
		return { eligible: true, ...value };
	}

	const api = {
		GLOBAL_SETTINGS_KEY,
		GLOBAL_SETTINGS_VERSION,
		getGlobalSettings,
		saveGlobalSettings
	};

	root.SoundAdjusterGlobalSettings = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
