'use strict';

(function initializeSiteExceptions(root) {
	if (!root.SoundAdjusterStorageWrites && typeof require === 'function') require('./site-profiles.js');
	const { enqueueStorageWrite } = root.SoundAdjusterStorageWrites;
	const EXCEPTIONS_VERSION = 1;
	const EXCEPTIONS_STORAGE_KEY = 'soundAdjuster.siteExceptions.v1';

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

	function normalizeSites(candidate) {
		const rawSites = candidate?.version === EXCEPTIONS_VERSION && Array.isArray(candidate.sites)
			? candidate.sites
			: [];
		return [...new Set(rawSites
			.filter(site => typeof site === 'string' && site.trim())
			.map(site => site.trim().toLowerCase()))]
			.sort((left, right) => left.localeCompare(right));
	}

	async function readSiteExceptions(storageArea) {
		if (!storageArea) return [];
		const stored = await storageArea.get(EXCEPTIONS_STORAGE_KEY);
		return normalizeSites(stored?.[EXCEPTIONS_STORAGE_KEY]);
	}

	async function writeSiteExceptionsNow(storageArea, sites) {
		const normalizedSites = normalizeSites({
			version: EXCEPTIONS_VERSION,
			sites
		});
		await storageArea.set({
			[EXCEPTIONS_STORAGE_KEY]: {
				version: EXCEPTIONS_VERSION,
				sites: normalizedSites
			}
		});
		return normalizedSites;
	}

	async function writeSiteExceptions(storageArea, sites) {
		return enqueueStorageWrite(storageArea, () => writeSiteExceptionsNow(storageArea, sites));
	}

	function ineligibleResult() {
		return { eligible: false, siteKey: null, disabled: false };
	}

	async function getSiteExceptionStatus(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();
		const sites = await readSiteExceptions(storageArea);
		return { eligible: true, siteKey, disabled: sites.includes(siteKey) };
	}

	async function addSiteException(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();
		return enqueueStorageWrite(storageArea, async () => {
			const sites = await readSiteExceptions(storageArea);
			if (!sites.includes(siteKey)) sites.push(siteKey);
			await writeSiteExceptionsNow(storageArea, sites);
			return { eligible: true, siteKey, disabled: true };
		});
	}

	async function removeSiteException(storageArea, urlValue, incognito = false) {
		const siteKey = normalizeSiteKey(urlValue);
		if (incognito || !siteKey || !storageArea) return ineligibleResult();
		return enqueueStorageWrite(storageArea, async () => {
			const sites = await readSiteExceptions(storageArea);
			await writeSiteExceptionsNow(storageArea, sites.filter(site => site !== siteKey));
			return { eligible: true, siteKey, disabled: false };
		});
	}

	async function removeSiteExceptionByKey(storageArea, siteKey) {
		if (!storageArea || typeof siteKey !== 'string') return { sites: [] };
		const normalizedKey = siteKey.trim().toLowerCase();
		return enqueueStorageWrite(storageArea, async () => {
			const sites = await readSiteExceptions(storageArea);
			return { sites: await writeSiteExceptionsNow(storageArea, sites.filter(site => site !== normalizedKey)) };
		});
	}

	async function clearSiteExceptions(storageArea) {
		if (!storageArea) return { sites: [] };
		return enqueueStorageWrite(storageArea, async () => {
			await storageArea.remove(EXCEPTIONS_STORAGE_KEY);
			return { sites: [] };
		});
	}

	async function listSiteExceptions(storageArea) {
		return { sites: await readSiteExceptions(storageArea) };
	}

	const api = {
		EXCEPTIONS_STORAGE_KEY,
		EXCEPTIONS_VERSION,
		addSiteException,
		clearSiteExceptions,
		getSiteExceptionStatus,
		listSiteExceptions,
		normalizeSiteKey,
		readSiteExceptions,
		removeSiteException,
		removeSiteExceptionByKey,
		writeSiteExceptions
	};

	root.SoundAdjusterSiteExceptions = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
