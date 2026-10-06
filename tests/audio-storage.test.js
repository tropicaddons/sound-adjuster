'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { create, isAudioKey } = require('../audio-storage.js');
const SITE = 'soundAdjuster.siteProfile.v1.example.test';
const NAMED = 'soundAdjuster.namedProfiles.v1.example.test';
const GLOBAL = 'soundAdjuster.globalSettings.v1';
const EXCEPTIONS = 'soundAdjuster.siteExceptions.v1';

// IndexedDB event/transaction test double. Requests succeed before transaction
// completion; a late abort discards every provisional write. Transactions are
// queued and each sees the last committed state, including separate connections.
function createIndexedDB(seed = {}) {
	const stores = new Map(Object.entries(seed).map(([key, value]) => [key, new Map(Object.entries(value))]));
	const pending = [];
	let active = false;
	const factory = { stores, commits: 0, abortNextCommit: false, failOpen: false, closed: 0 };

	function startNext() {
		if (active || !pending.length) return;
		active = true;
		const transaction = pending.shift();
		transaction.start();
	}

	factory.open = () => {
		const request = {};
		setImmediate(() => {
			if (factory.failOpen) {
				request.error = new Error('open failed');
				request.onerror?.({ target: request });
				return;
			}
			let closed = false;
			request.result = {
				objectStoreNames: { contains: name => stores.has(name) },
				createObjectStore(name) { stores.set(name, new Map()); },
				close() { closed = true; factory.closed += 1; },
				transaction(names, mode) {
					if (closed) throw new Error('database closed');
					const operations = [];
					let snapshots;
					let started = false;
					let finished = false;
					let scheduled = false;
					const transaction = {
						start() {
							started = true;
							snapshots = new Map(names.map(name => [name, structuredClone(stores.get(name))]));
							schedule();
						},
						abort() { finish(new Error('transaction aborted')); },
						objectStore(name) {
							assert(names.includes(name));
							return {
								get: key => enqueue(() => snapshots.get(name).get(key)),
								put(value, key) {
									const cloned = structuredClone(value);
									return enqueue(() => {
										assert.equal(mode, 'readwrite');
										snapshots.get(name).set(key, cloned);
										return key;
									});
								},
								delete: key => enqueue(() => {
									assert.equal(mode, 'readwrite');
									snapshots.get(name).delete(key);
								}),
								openCursor() {
									const request = {};
									let entries;
									let position = 0;
									function advance() {
										operations.push(() => {
											entries ||= [...snapshots.get(name)];
											const entry = entries[position++];
											request.result = entry ? { key: entry[0], value: structuredClone(entry[1]), continue: advance } : null;
											request.onsuccess?.({ target: request });
										});
										schedule();
									}
									advance();
									return request;
								}
							};
						}
					};
					function finish(error) {
						if (finished) return;
						finished = true;
						const pendingIndex = pending.indexOf(transaction);
						if (pendingIndex >= 0) pending.splice(pendingIndex, 1);
						if (error) {
							transaction.error = error;
							transaction.onerror?.({ target: transaction });
							transaction.onabort?.({ target: transaction });
						} else {
							if (mode === 'readwrite') {
								for (const [name, values] of snapshots) stores.set(name, values);
							}
							factory.commits += 1;
							transaction.oncomplete?.({ target: transaction });
						}
						if (started) active = false;
						startNext();
					}
					function schedule() {
						if (!started || scheduled || finished) return;
						scheduled = true;
						setImmediate(() => {
							scheduled = false;
							if (finished) return;
							if (operations.length) {
								try { operations.shift()(); } catch (error) { finish(error); }
								schedule();
							} else if (factory.abortNextCommit) {
								factory.abortNextCommit = false;
								finish(new Error('commit failed after request success'));
							} else finish();
						});
					}
					function enqueue(operation) {
						const request = {};
						operations.push(() => {
							request.result = structuredClone(operation());
							request.onsuccess?.({ target: request });
						});
						schedule();
						return request;
					}
					pending.push(transaction);
					setImmediate(startNext);
					return transaction;
				}
			};
			if (!stores.has('audio') || !stores.has('metadata')) request.onupgradeneeded?.({ target: request });
			request.onsuccess?.({ target: request });
		});
		return request;
	};
	return factory;
}

function createLocal(values = {}) {
	return {
		values: structuredClone(values),
		removes: [],
		async get() { return structuredClone(this.values); },
		async remove(keys) {
			this.removes.push([...keys]);
			for (const key of keys) delete this.values[key];
		}
	};
}

test('migration commits audio data before deleting legacy keys and preserves unrelated storage', async () => {
	const factory = createIndexedDB();
	const local = createLocal({ [SITE]: { gain: 2 }, [GLOBAL]: { enabled: true }, appearance: 'dark', 'soundAdjuster.siteProfile.v2.future': { gain: 4 } });
	const originalRemove = local.remove;
	local.remove = async function remove(keys) {
		assert(factory.commits > 0);
		assert.deepEqual(factory.stores.get('audio').get(SITE), { gain: 2 });
		return originalRemove.call(this, keys);
	};
	const adapter = await create(local, factory);
	assert.deepEqual(await adapter.get(null), { [SITE]: { gain: 2 }, [GLOBAL]: { enabled: true } });
	assert.deepEqual(local.values, { appearance: 'dark', 'soundAdjuster.siteProfile.v2.future': { gain: 4 } });
});

test('existing database values outrank older local values during the first migration', async () => {
	const factory = createIndexedDB({ audio: { [SITE]: { gain: 4 } }, metadata: {} });
	const adapter = await create(createLocal({ [SITE]: { gain: 2 }, [NAMED]: { profiles: [] } }), factory);
	assert.deepEqual(await adapter.get([SITE, NAMED]), { [SITE]: { gain: 4 }, [NAMED]: { profiles: [] } });
});

test('migration abort after successful requests leaves originals and permits a complete retry', async () => {
	const factory = createIndexedDB();
	factory.abortNextCommit = true;
	const local = createLocal({ [SITE]: { gain: 2 }, [EXCEPTIONS]: { sites: ['example.test'] } });
	await assert.rejects(create(local, factory), /commit failed/);
	assert.deepEqual(local.removes, []);
	assert.equal(factory.stores.get('audio').size, 0);
	assert.equal(factory.stores.get('metadata').size, 0);
	const adapter = await create(local, factory);
	assert.deepEqual(await adapter.get(SITE), { [SITE]: { gain: 2 } });
	assert.deepEqual(local.values, {});
});

test('failed legacy deletion rejects startup; retries never reimport legacy injection after commit', async () => {
	const factory = createIndexedDB();
	const local = createLocal({ [SITE]: { gain: 2 } });
	const originalRemove = local.remove;
	local.remove = async () => { throw new Error('local remove failed'); };
	await assert.rejects(create(local, factory), /local remove failed/);
	assert.deepEqual(local.values, { [SITE]: { gain: 2 } });
	local.values[SITE] = { gain: 5 };
	local.values[NAMED] = { profiles: ['forged'] };
	local.remove = originalRemove;
	const adapter = await create(local, factory);
	assert.deepEqual(await adapter.get(null), { [SITE]: { gain: 2 } });
	assert.deepEqual(local.values, {});
});

test('CRUD retains storage.local-compatible key shapes and returns independent values', async () => {
	const local = createLocal();
	const adapter = await create(local, createIndexedDB());
	await adapter.set({ [SITE]: { gain: 2 }, [GLOBAL]: { enabled: true } });
	const values = await adapter.get(SITE);
	values[SITE].gain = 5;
	assert.deepEqual(await adapter.get([SITE, EXCEPTIONS]), { [SITE]: { gain: 2 } });
	await adapter.remove([SITE, EXCEPTIONS]);
	assert.deepEqual(await adapter.get(null), { [GLOBAL]: { enabled: true } });
	await adapter.remove(GLOBAL);
	assert.deepEqual(await adapter.get(null), {});
	assert.deepEqual(local.values, {});
});

test('late transaction abort rejects set/remove and rolls back every provisional change', async () => {
	const factory = createIndexedDB();
	const adapter = await create(createLocal(), factory);
	await adapter.set({ [SITE]: { gain: 1 }, [GLOBAL]: { enabled: false } });
	factory.abortNextCommit = true;
	await assert.rejects(adapter.set({ [SITE]: { gain: 5 }, [GLOBAL]: { enabled: true } }), /commit failed/);
	assert.deepEqual(await adapter.get(null), { [SITE]: { gain: 1 }, [GLOBAL]: { enabled: false } });
	factory.abortNextCommit = true;
	await assert.rejects(adapter.remove([SITE, GLOBAL]), /commit failed/);
	assert.deepEqual(await adapter.get(null), { [SITE]: { gain: 1 }, [GLOBAL]: { enabled: false } });
	await adapter.set({ [SITE]: { gain: 2 } });
	assert.deepEqual(await adapter.get(SITE), { [SITE]: { gain: 2 } });
});

test('uncloneable values abort the whole write and retain the original DataCloneError', async () => {
	const adapter = await create(createLocal(), createIndexedDB());
	await adapter.set({ [SITE]: { gain: 2 } });
	await assert.rejects(adapter.set({ [SITE]: { gain: 5 }, [GLOBAL]: () => {} }), { name: 'DataCloneError' });
	assert.deepEqual(await adapter.get(null), { [SITE]: { gain: 2 } });
});

test('read request success does not hide a later transaction abort', async () => {
	const factory = createIndexedDB();
	const adapter = await create(createLocal({ [SITE]: { gain: 2 } }), factory);
	factory.abortNextCommit = true;
	await assert.rejects(adapter.get(SITE), /commit failed/);
	assert.deepEqual(await adapter.get(SITE), { [SITE]: { gain: 2 } });
});

test('audio-only key validation rejects mixed writes atomically and hides migration metadata', async () => {
	const adapter = await create(createLocal(), createIndexedDB());
	await assert.rejects(adapter.set({ [SITE]: { gain: 2 }, appearance: 'light' }), /audio keys/);
	assert.deepEqual(await adapter.get(null), {});
	await assert.rejects(adapter.get('localStorageMigration.v1'), /audio keys/);
	await assert.rejects(adapter.remove(['appearance', SITE]), /audio keys/);
	await assert.rejects(adapter.set([]), /must be an object/);
	assert.equal(isAudioKey('soundAdjuster.siteProfile.v1.'), false);
	assert.equal(isAudioKey('soundAdjuster.namedProfiles.v2.test'), false);
});

test('missing or failed IndexedDB rejects instead of falling back to public local storage', async () => {
	const local = createLocal({ [SITE]: { gain: 3 } });
	await assert.rejects(create(local, undefined), /requires/);
	const factory = createIndexedDB();
	factory.failOpen = true;
	await assert.rejects(create(local, factory), /open failed/);
	assert.deepEqual(local.values, { [SITE]: { gain: 3 } });
	assert.deepEqual(local.removes, []);
});

test('fresh connections after completed migration cannot restore deleted profiles from raw storage', async () => {
	const factory = createIndexedDB();
	const local = createLocal({ [SITE]: { gain: 2 } });
	const first = await create(local, factory);
	await first.remove(SITE);
	local.values[SITE] = { gain: 5 };
	const second = await create(local, factory);
	assert.deepEqual(await second.get(null), {});
	assert.deepEqual(local.values, {});
});
