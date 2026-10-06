'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

require('../popup-state.js');
const {
	MAX_PROFILES_PER_SITE,
	NAMED_PROFILES_KEY_PREFIX,
	getNamedProfiles,
	removeNamedProfile,
	saveNamedProfile
} = require('../named-profiles.js');

function createStorage() {
	const values = new Map();
	const calls = { get: 0, set: 0 };
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
		}
	};
}

test('named profiles keep complete audio snapshots isolated to each site', async () => {
	const storage = createStorage();
	const settings = {
		gain: 2.75,
		pan: -0.35,
		mono: true,
		flip: true,
		eqBass: 6,
		eqLowMid: 2,
		eqMid: -3,
		eqHighMid: 4,
		eqTreble: 7
	};

	const saved = await saveNamedProfile(
		storage,
		'https://www.youtube.com/watch?v=1',
		'  Loud   dialogue  ',
		settings,
		false,
		100,
		() => 'profile-one'
	);

	assert.equal(saved.siteKey, 'youtube.com');
	assert.equal(saved.profiles[0].name, 'Loud dialogue');
	assert.deepEqual(saved.profiles[0].settings, settings);
	assert.equal(storage.values.has(`${NAMED_PROFILES_KEY_PREFIX}youtube.com`), true);

	const sameSite = await getNamedProfiles(storage, 'https://youtube.com/shorts/2');
	assert.equal(sameSite.profiles.length, 1);
	assert.deepEqual(sameSite.profiles[0].settings, settings);

	const otherSite = await getNamedProfiles(storage, 'https://example.com/video');
	assert.deepEqual(otherSite.profiles, []);
});

test('saving the same name updates that site profile instead of duplicating it', async () => {
	const storage = createStorage();
	const url = 'https://example.test/player';
	await saveNamedProfile(storage, url, 'Night', { gain: 0.8 }, false, 100, () => 'night-id');
	const updated = await saveNamedProfile(storage, url, 'night', { gain: 1.6, eqBass: 4 }, false, 200);

	assert.equal(updated.profiles.length, 1);
	assert.equal(updated.profiles[0].id, 'night-id');
	assert.equal(updated.profiles[0].createdAt, 100);
	assert.equal(updated.profiles[0].updatedAt, 200);
	assert.equal(updated.profiles[0].settings.gain, 1.6);
	assert.equal(updated.profiles[0].settings.eqBass, 4);
});

test('profiles can be removed and private pages never touch storage', async () => {
	const storage = createStorage();
	const url = 'https://example.test/player';
	await saveNamedProfile(storage, url, 'Speech', { gain: 1.4 }, false, 100, () => 'speech-id');
	const removed = await removeNamedProfile(storage, url, 'speech-id');
	assert.deepEqual(removed.profiles, []);

	const callsBeforePrivateAccess = { ...storage.calls };
	const privateRead = await getNamedProfiles(storage, url, true);
	const privateSave = await saveNamedProfile(storage, url, 'Private', { gain: 2 }, true);
	assert.equal(privateRead.eligible, false);
	assert.equal(privateSave.eligible, false);
	assert.deepEqual(storage.calls, callsBeforePrivateAccess);
});

test('a site has a bounded named profile library', async () => {
	const storage = createStorage();
	const url = 'https://example.test/player';
	for (let index = 0; index < MAX_PROFILES_PER_SITE; index += 1) {
		await saveNamedProfile(
			storage,
			url,
			`Profile ${index + 1}`,
			{ gain: 1 + (index / 10) },
			false,
			index,
			() => `profile-${index + 1}`
		);
	}

	await assert.rejects(
		saveNamedProfile(storage, url, 'One too many', { gain: 2 }),
		/at most/
	);
});
