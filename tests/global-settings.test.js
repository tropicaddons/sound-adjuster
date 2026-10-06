'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

require('../popup-state.js');
const {
	GLOBAL_SETTINGS_KEY,
	getGlobalSettings,
	saveGlobalSettings
} = require('../global-settings.js');

function createStorage() {
	const values = new Map();
	return {
		values,
		async get(key) {
			return values.has(key) ? { [key]: values.get(key) } : {};
		},
		async set(entries) {
			for (const [key, value] of Object.entries(entries)) values.set(key, value);
		}
	};
}

test('global defaults are opt-in and migrate legacy extra boost settings to 5x', async () => {
	const storage = createStorage();
	const initial = await getGlobalSettings(storage);
	assert.equal(initial.enabled, false);
	assert.equal(initial.settings.gain, 1);

	const saved = await saveGlobalSettings(storage, true, {
		gain: 8.5,
		extraBoost: true,
		limiter: true,
		pan: -0.25,
		eqMid: 3
	}, false, 100);
	assert.equal(saved.enabled, true);
	assert.equal(saved.settings.gain, 5);
	assert.equal('extraBoost' in saved.settings, false);
	assert.equal('limiter' in saved.settings, false);
	assert.equal(storage.values.has(GLOBAL_SETTINGS_KEY), true);

	const loaded = await getGlobalSettings(storage);
	assert.equal(loaded.updatedAt, 100);
	assert.deepEqual(loaded.settings, saved.settings);
});

test('global defaults clamp to 5x and stay unavailable in private windows', async () => {
	const storage = createStorage();
	const saved = await saveGlobalSettings(storage, true, { gain: 9 }, false, 200);
	assert.equal(saved.settings.gain, 5);

	const privateResult = await getGlobalSettings(storage, true);
	assert.equal(privateResult.eligible, false);
	assert.equal(privateResult.enabled, false);
});
