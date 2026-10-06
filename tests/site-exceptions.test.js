'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
	EXCEPTIONS_STORAGE_KEY,
	addSiteException,
	clearSiteExceptions,
	getSiteExceptionStatus,
	listSiteExceptions,
	removeSiteException,
	removeSiteExceptionByKey
} = require('../site-exceptions.js');

class MemoryStorage {
	constructor() {
		this.values = {};
	}

	async get(key) {
		return { [key]: this.values[key] };
	}

	async set(values) {
		Object.assign(this.values, values);
	}

	async remove(key) {
		delete this.values[key];
	}
}

test('site exceptions are normalized, deduplicated, listed, and removed', async () => {
	const storage = new MemoryStorage();

	await addSiteException(storage, 'https://www.Example.com/watch');
	await addSiteException(storage, 'https://example.com/another');
	await addSiteException(storage, 'https://media.test:8443/video');

	assert.deepEqual(
		(await listSiteExceptions(storage)).sites,
		['example.com', 'media.test:8443']
	);
	assert.deepEqual(
		await getSiteExceptionStatus(storage, 'https://example.com/page'),
		{ eligible: true, siteKey: 'example.com', disabled: true }
	);

	await removeSiteException(storage, 'https://example.com/page');
	assert.deepEqual((await listSiteExceptions(storage)).sites, ['media.test:8443']);

	await removeSiteExceptionByKey(storage, 'MEDIA.TEST:8443');
	assert.deepEqual((await listSiteExceptions(storage)).sites, []);
});

test('private and non-http pages cannot create site exceptions', async () => {
	const storage = new MemoryStorage();
	assert.equal((await addSiteException(storage, 'https://example.com', true)).eligible, false);
	assert.equal((await addSiteException(storage, 'about:debugging')).eligible, false);
	assert.equal(storage.values[EXCEPTIONS_STORAGE_KEY], undefined);
});

test('clear removes every stored site exception', async () => {
	const storage = new MemoryStorage();
	await addSiteException(storage, 'https://one.test');
	await addSiteException(storage, 'https://two.test');
	await clearSiteExceptions(storage);
	assert.deepEqual((await listSiteExceptions(storage)).sites, []);
});
