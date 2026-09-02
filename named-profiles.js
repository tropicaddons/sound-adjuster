'use strict';

(function initializeNamedProfiles(root) {
	const NAMED_PROFILES_VERSION = 1;
	const NAMED_PROFILES_KEY_PREFIX = 'soundAdjuster.namedProfiles.v1.';
	const MAX_PROFILES_PER_SITE = 12;
	const MAX_PROFILE_NAME_LENGTH = 32;

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

	function namedProfilesStorageKey(siteKey) {
		return siteKey ? `${NAMED_PROFILES_KEY_PREFIX}${siteKey}` : null;
	}

	function normalizeSettings(settings) {
		const stateApi = root.SoundAdjusterPopupState;
		if (stateApi?.normalizeSettings) return stateApi.normalizeSettings(settings);
		return { ...settings };
	}

	function normalizeProfileName(value) {
		if (typeof value !== 'string') return null;
		const normalized = value.trim().replace(/\s+/g, ' ').slice(0, MAX_PROFILE_NAME_LENGTH);
		return normalized || null;
	}

	function normalizeProfiles(candidate) {
		if (candidate?.version !== NAMED_PROFILES_VERSION || !Array.isArray(candidate.profiles)) return [];
		const ids = new Set();
		const names = new Set();
		const profiles = [];

		for (const value of candidate.profiles) {
			const id = typeof value?.id === 'string' ? value.id.trim() : '';
			const name = normalizeProfileName(value?.name);
			const nameKey = name?.toLocaleLowerCase('en-US');
			if (!id || !name || ids.has(id) || names.has(nameKey)) continue;
			ids.add(id);
			names.add(nameKey);
			profiles.push({
				id,
				name,
				settings: normalizeSettings(value.settings),
				createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0,
				updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0
			});
			if (profiles.length >= MAX_PROFILES_PER_SITE) break;
		}
		return profiles;
	}

	function ineligibleResult() {
		return { eligible: false, siteKey: null, profiles: [] };
	}

	async function getNamedProfiles(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();
		const key = namedProfilesStorageKey(siteKey);
		const stored = await storageArea.get(key);
		return {
			eligible: true,
			siteKey,
			profiles: normalizeProfiles(stored?.[key])
		};
	}

	function createProfileId(now) {
		if (root.crypto?.randomUUID) return root.crypto.randomUUID();
		return `profile-${now}-${Math.random().toString(36).slice(2, 10)}`;
	}

	async function saveNamedProfile(
		storageArea,
		urlValue,
		nameValue,
		settings,
		incognito = false,
		now = Date.now(),
		idFactory = createProfileId
	) {
		const current = await getNamedProfiles(storageArea, urlValue, incognito);
		if (!current.eligible) return current;
		const name = normalizeProfileName(nameValue);
		if (!name) throw new TypeError('Profile name is required');

		const nameKey = name.toLocaleLowerCase('en-US');
		const existingIndex = current.profiles.findIndex(profile => (
			profile.name.toLocaleLowerCase('en-US') === nameKey
		));
		const profile = existingIndex >= 0
			? {
				...current.profiles[existingIndex],
				name,
				settings: normalizeSettings(settings),
				updatedAt: now
			}
			: {
				id: idFactory(now),
				name,
				settings: normalizeSettings(settings),
				createdAt: now,
				updatedAt: now
			};

		if (existingIndex < 0 && current.profiles.length >= MAX_PROFILES_PER_SITE) {
			throw new RangeError(`A site can have at most ${MAX_PROFILES_PER_SITE} profiles`);
		}

		const profiles = [...current.profiles];
		if (existingIndex >= 0) profiles[existingIndex] = profile;
		else profiles.push(profile);

		await storageArea.set({
			[namedProfilesStorageKey(current.siteKey)]: {
				version: NAMED_PROFILES_VERSION,
				siteKey: current.siteKey,
				profiles
			}
		});
		return { ...current, profiles, savedProfile: profile };
	}

	async function removeNamedProfile(storageArea, urlValue, profileId, incognito = false) {
		const current = await getNamedProfiles(storageArea, urlValue, incognito);
		if (!current.eligible) return current;
		const profiles = current.profiles.filter(profile => profile.id !== profileId);
		await storageArea.set({
			[namedProfilesStorageKey(current.siteKey)]: {
				version: NAMED_PROFILES_VERSION,
				siteKey: current.siteKey,
				profiles
			}
		});
		return { ...current, profiles };
	}

	const api = {
		MAX_PROFILE_NAME_LENGTH,
		MAX_PROFILES_PER_SITE,
		NAMED_PROFILES_KEY_PREFIX,
		NAMED_PROFILES_VERSION,
		getNamedProfiles,
		namedProfilesStorageKey,
		normalizeProfileName,
		normalizeProfiles,
		removeNamedProfile,
		saveNamedProfile
	};

	root.SoundAdjusterNamedProfiles = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
