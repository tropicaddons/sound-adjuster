'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
require('../popup-state.js');
const sites = require('../site-profiles.js');
const exceptions = require('../site-exceptions.js');
const named = require('../named-profiles.js');
const defaults = require('../global-settings.js');

function createStorage() {
	return {
		values: {},
		calls: 0,
		async get(key) {
			this.calls += 1;
			return structuredClone(key === null ? this.values : { [key]: this.values[key] });
		},
		async set(entries) {
			this.calls += 1;
			Object.assign(this.values, structuredClone(entries));
		},
		async remove(keys) {
			this.calls += 1;
			for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
		}
	};
}

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

test('concurrent exception additions and removals preserve every ordered change', async () => {
	const storage = createStorage();
	await Promise.all([
		exceptions.addSiteException(storage, 'https://first.test'),
		exceptions.addSiteException(storage, 'https://second.test'),
		exceptions.addSiteException(storage, 'https://third.test'),
		exceptions.removeSiteException(storage, 'https://first.test'),
		exceptions.removeSiteExceptionByKey(storage, 'SECOND.TEST')
	]);
	assert.deepEqual((await exceptions.listSiteExceptions(storage)).sites, ['third.test']);
});

test('exception clear is ordered between pending saves without resurrecting old sites', async () => {
	const storage = createStorage();
	await Promise.all([
		exceptions.addSiteException(storage, 'https://before.test'),
		exceptions.clearSiteExceptions(storage),
		exceptions.addSiteException(storage, 'https://after.test')
	]);
	assert.deepEqual((await exceptions.listSiteExceptions(storage)).sites, ['after.test']);
});

test('failed exception writes reject their caller and do not poison later changes', async () => {
	const storage = createStorage();
	const originalSet = storage.set;
	let failOnce = true;
	storage.set = async function set(entries) {
		if (failOnce) {
			failOnce = false;
			throw new Error('simulated quota error');
		}
		return originalSet.call(this, entries);
	};
	const failed = exceptions.addSiteException(storage, 'https://failed.test');
	const next = exceptions.addSiteException(storage, 'https://next.test');
	await assert.rejects(failed, /quota error/);
	await next;
	assert.deepEqual((await exceptions.listSiteExceptions(storage)).sites, ['next.test']);
});

test('simultaneous named profile saves retain separate names and same-name updates keep their id', async () => {
	const storage = createStorage();
	const url = 'https://example.test';
	await Promise.all([
		named.saveNamedProfile(storage, url, 'First', { gain: 2 }, false, 10, () => 'first'),
		named.saveNamedProfile(storage, url, 'Second', { gain: 3 }, false, 20, () => 'second'),
		named.saveNamedProfile(storage, url, 'FIRST', { gain: 4 }, false, 30, () => 'unexpected')
	]);
	const result = await named.getNamedProfiles(storage, url);
	assert.deepEqual(result.profiles.map(profile => profile.id), ['first', 'second']);
	assert.equal(result.profiles[0].settings.gain, 4);
	assert.equal(result.profiles[0].createdAt, 10);
	assert.equal(result.profiles[0].updatedAt, 30);
	await Promise.all([
		named.removeNamedProfile(storage, url, 'first'),
		named.saveNamedProfile(storage, url, 'Third', { gain: 1 }, false, 40, () => 'third')
	]);
	assert.deepEqual((await named.getNamedProfiles(storage, url)).profiles.map(profile => profile.id), ['second', 'third']);
});

test('concurrent named creates enforce the twelve-profile limit and rejected changes recover', async () => {
	const storage = createStorage();
	const url = 'https://example.test';
	const results = await Promise.allSettled(Array.from({ length: 14 }, (_, index) => (
		named.saveNamedProfile(storage, url, `Profile ${index}`, { gain: 50 }, false, index, () => `id-${index}`)
	)));
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 12);
	assert.equal(results.filter(result => result.status === 'rejected').length, 2);
	const updated = await named.saveNamedProfile(storage, url, 'Profile 0', { gain: 50 });
	assert.equal(updated.profiles.length, 12);
	assert.equal(updated.savedProfile.settings.gain, 5);
});

test('bulk deletion shares the write queue and deletes all audio data while preserving other keys', async () => {
	const storage = createStorage();
	storage.values = {
		appearance: 'dark',
		supportDismissed: true,
		'soundAdjuster.siteProfile.v2.future.test': { version: 2 },
		'soundAdjuster.namedProfiles.v2.future.test': { version: 2 }
	};
	const retained = structuredClone(storage.values);
	const results = await Promise.all([
		sites.saveSiteProfile(storage, 'https://old.test', { gain: 2 }),
		named.saveNamedProfile(storage, 'https://old.test', 'Old', { gain: 3 }),
		defaults.saveGlobalSettings(storage, true, { gain: 4 }),
		exceptions.addSiteException(storage, 'https://old.test'),
		sites.clearAllAudioData(storage),
		named.saveNamedProfile(storage, 'https://new.test', 'New', { gain: 1 })
	]);
	assert.deepEqual(results[4], { eligible: true, removed: 4 });
	assert.deepEqual(Object.keys(storage.values).sort(), [
		...Object.keys(retained), `${named.NAMED_PROFILES_KEY_PREFIX}new.test`
	].sort());
	for (const [key, value] of Object.entries(retained)) assert.deepEqual(storage.values[key], value);
	assert.deepEqual((await exceptions.listSiteExceptions(storage)).sites, []);
	assert.equal((await defaults.getGlobalSettings(storage)).enabled, false);
});

test('selective bulk clears remove only their versioned profile type and remain ordered with creates', async () => {
	const storage = createStorage();
	await Promise.all([
		sites.saveSiteProfile(storage, 'https://old.test', {}),
		named.saveNamedProfile(storage, 'https://old.test', 'Old', {}),
		sites.clearAllSiteProfiles(storage),
		sites.saveSiteProfile(storage, 'https://new.test', {})
	]);
	assert.equal((await sites.getSiteProfile(storage, 'https://old.test')).remembered, false);
	assert.equal((await sites.getSiteProfile(storage, 'https://new.test')).remembered, true);
	assert.equal((await named.getNamedProfiles(storage, 'https://old.test')).profiles.length, 1);
	await Promise.all([
		named.clearAllNamedProfiles(storage),
		named.saveNamedProfile(storage, 'https://new.test', 'New', {})
	]);
	assert.deepEqual((await named.getNamedProfiles(storage, 'https://old.test')).profiles, []);
	assert.equal((await sites.getSiteProfile(storage, 'https://new.test')).remembered, true);
});

test('a slow storage area does not block reads or writes to another storage area', async () => {
	const storage = createStorage();
	const other = createStorage();
	const entered = deferred();
	const release = deferred();
	const originalSet = storage.set;
	storage.set = async function set(entries) {
		entered.resolve();
		await release.promise;
		return originalSet.call(this, entries);
	};
	const blocked = sites.saveSiteProfile(storage, 'https://slow.test', {});
	await entered.promise;
	try {
		assert.deepEqual((await exceptions.listSiteExceptions(storage)).sites, []);
		await exceptions.addSiteException(other, 'https://fast.test');
		assert.equal((await exceptions.getSiteExceptionStatus(other, 'https://fast.test')).disabled, true);
	} finally {
		release.resolve();
	}
	await blocked;
});

test('site save followed by removal cannot resurrect the profile when the write is delayed', async () => {
	const storage = createStorage();
	const entered = deferred();
	const release = deferred();
	const originalSet = storage.set;
	storage.set = async function set(entries) {
		entered.resolve();
		await release.promise;
		return originalSet.call(this, entries);
	};
	const pending = sites.saveSiteProfile(storage, 'https://example.test', {});
	await entered.promise;
	const removal = sites.removeSiteProfile(storage, 'https://example.test');
	release.resolve();
	await Promise.all([pending, removal]);
	assert.equal((await sites.getSiteProfile(storage, 'https://example.test')).remembered, false);
});

test('bulk-delete rejection does not block later named, global or site writes', async () => {
	const storage = createStorage();
	await sites.saveSiteProfile(storage, 'https://old.test', {});
	const originalRemove = storage.remove;
	storage.remove = async () => { throw new Error('delete failed'); };
	const failed = sites.clearAllAudioData(storage);
	const pending = named.saveNamedProfile(storage, 'https://next.test', 'Next', {});
	await assert.rejects(failed, /delete failed/);
	await pending;
	storage.remove = originalRemove;
	await Promise.all([
		defaults.saveGlobalSettings(storage, true, {}),
		defaults.clearGlobalSettings(storage)
	]);
	assert.equal((await defaults.getGlobalSettings(storage)).enabled, false);
});

test('private bulk deletion helpers never access normal storage', async () => {
	const storage = createStorage();
	const results = await Promise.all([
		sites.clearAllAudioData(storage, true),
		sites.clearAllSiteProfiles(storage, true),
		named.clearAllNamedProfiles(storage, true),
		defaults.clearGlobalSettings(storage, true)
	]);
	for (const result of results) assert.equal(result.eligible, false);
	assert.equal(storage.calls, 0);
});
