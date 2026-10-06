'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

require('../popup-state.js');
const {
	PROFILE_KEY_PREFIX,
	getSiteProfile,
	normalizeSiteKey,
	profileStorageKey,
	removeSiteProfile,
	saveSiteProfile
} = require('../site-profiles.js');

function createStorage() {
	const values = new Map();
	const calls = { get: 0, set: 0, remove: 0 };
	return {
		calls,
		values,
		async get(key) {
			calls.get += 1;
			return values.has(key) ? { [key]: values.get(key) } : {};
		},
		async set(entries) {
			calls.set += 1;
			for (const [key, value] of Object.entries(entries)) values.set(key, value);
		},
		async remove(key) {
			calls.remove += 1;
			values.delete(key);
		}
	};
}

test('site keys strip www, lowercase hosts, preserve custom ports, and ignore paths', () => {
	assert.equal(normalizeSiteKey('https://WWW.Example.COM/watch?v=1'), 'example.com');
	assert.equal(normalizeSiteKey('http://www.Example.com:8080/other'), 'example.com:8080');
	assert.equal(normalizeSiteKey('https://example.com:443/path'), 'example.com');
	assert.equal(normalizeSiteKey('about:config'), null);
	assert.equal(normalizeSiteKey('file:///tmp/audio.mp3'), null);
	assert.equal(normalizeSiteKey('not a URL'), null);
});

test('a profile can be created, read with all settings, updated, and removed', async () => {
	const storage = createStorage();
	const url = 'https://www.Example.test/player?id=4';
	const settings = {
		gain: 2.4,
		pan: -0.4,
		mono: true,
		flip: true,
		eqBass: 5,
		eqLowMid: 2,
		eqMid: -1,
		eqHighMid: 3,
		eqTreble: 4
	};

	const saved = await saveSiteProfile(storage, url, settings, false, 100);
	assert.equal(saved.remembered, true);
	assert.equal(saved.siteKey, 'example.test');
	assert.equal(saved.profile.updatedAt, 100);
	assert.deepEqual(saved.profile.settings, settings);
	assert.equal(
		storage.values.has(`${PROFILE_KEY_PREFIX}example.test`),
		true
	);

	const loaded = await getSiteProfile(storage, 'https://example.test/different-path', false);
	assert.equal(loaded.remembered, true);
	assert.deepEqual(loaded.profile.settings, settings);

	const updated = await saveSiteProfile(storage, url, { ...settings, gain: 9 }, false, 200);
	assert.equal(updated.profile.settings.gain, 5);
	assert.equal(updated.profile.updatedAt, 200);
	const legacyBoosted = await saveSiteProfile(
		storage,
		url,
		{ ...settings, gain: 9, extraBoost: true, limiter: true },
		false,
		300
	);
	assert.equal(legacyBoosted.profile.settings.gain, 5);
	assert.equal('extraBoost' in legacyBoosted.profile.settings, false);
	assert.equal('limiter' in legacyBoosted.profile.settings, false);

	const removed = await removeSiteProfile(storage, url, false);
	assert.equal(removed.remembered, false);
	assert.equal(storage.values.has(profileStorageKey('example.test')), false);
});

test('private and non-http pages never read or write local storage', async () => {
	const storage = createStorage();
	const privateRead = await getSiteProfile(storage, 'https://example.test', true);
	const privateSave = await saveSiteProfile(storage, 'https://example.test', { gain: 2 }, true);
	const privateRemove = await removeSiteProfile(storage, 'https://example.test', true);
	const aboutRead = await getSiteProfile(storage, 'about:config', false);
	const aboutSave = await saveSiteProfile(storage, 'about:config', { gain: 2 }, false);

	for (const result of [privateRead, privateSave, privateRemove, aboutRead, aboutSave]) {
		assert.equal(result.eligible, false);
		assert.equal(result.remembered, false);
	}
	assert.deepEqual(storage.calls, { get: 0, set: 0, remove: 0 });
});
