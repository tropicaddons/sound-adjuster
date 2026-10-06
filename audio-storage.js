'use strict';

(function initializeAudioStorage(root) {
	const DATABASE_NAME = 'soundAdjuster.audio.v1';
	const DATABASE_VERSION = 1;
	const AUDIO_STORE = 'audio';
	const META_STORE = 'metadata';
	const MIGRATION_KEY = 'localStorageMigration.v1';
	const PREFIXES = ['soundAdjuster.siteProfile.v1.', 'soundAdjuster.namedProfiles.v1.'];
	const SINGLE_KEYS = new Set(['soundAdjuster.globalSettings.v1', 'soundAdjuster.siteExceptions.v1']);

	function isAudioKey(key) {
		return typeof key === 'string' && (SINGLE_KEYS.has(key)
			|| PREFIXES.some(prefix => key.startsWith(prefix) && key.length > prefix.length));
	}

	function checkedKeys(keys) {
		const values = typeof keys === 'string' ? [keys] : keys;
		if (!Array.isArray(values) || values.some(key => !isAudioKey(key))) {
			throw new TypeError('Only versioned Sound Adjuster audio keys are allowed');
		}
		return [...new Set(values)];
	}

	function openDatabase(indexedDB) {
		return new Promise((resolve, reject) => {
			let blocked = false;
			const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(AUDIO_STORE)) database.createObjectStore(AUDIO_STORE);
				if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
			};
			request.onerror = () => reject(request.error || new Error('Audio database could not be opened'));
			request.onblocked = () => {
				blocked = true;
				reject(new Error('Audio database upgrade is blocked'));
			};
			request.onsuccess = () => {
				const database = request.result;
				if (blocked) {
					database.close();
					return;
				}
				database.onversionchange = () => database.close();
				resolve(database);
			};
		});
	}

	// Request success is provisional. Resolve only after the entire transaction
	// commits, including quota failures or aborts after an individual put succeeds.
	function transact(database, storeNames, mode, operation) {
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(storeNames, mode);
			let result;
			let failure;
			transaction.oncomplete = () => resolve(result);
			transaction.onerror = event => { failure ||= event.target?.error || transaction.error; };
			transaction.onabort = () => reject(failure || transaction.error || new Error('Audio transaction aborted'));
			try {
				operation(transaction, value => { result = value; });
			} catch (error) {
				failure = error;
				transaction.abort();
			}
		});
	}

	async function migrateLegacy(database, storageArea) {
		const stored = await storageArea.get(null);
		const keys = Object.keys(stored || {}).filter(isAudioKey);
		await transact(database, [AUDIO_STORE, META_STORE], 'readwrite', transaction => {
			const metadata = transaction.objectStore(META_STORE);
			const audio = transaction.objectStore(AUDIO_STORE);
			const marker = metadata.get(MIGRATION_KEY);
			marker.onsuccess = () => {
				if (marker.result === true) return;
				for (const key of keys) {
					const existing = audio.get(key);
					existing.onsuccess = () => {
						if (existing.result === undefined) audio.put(stored[key], key);
					};
				}
				metadata.put(true, MIGRATION_KEY);
			};
		});
		// A failure here is reported to the caller. The committed migration marker
		// makes retries cleanup-only and prevents later untrusted legacy injection.
		if (keys.length) await storageArea.remove(keys);
	}

	async function create(storageArea, indexedDB) {
		if (!storageArea?.get || !storageArea?.remove || !indexedDB?.open) {
			throw new TypeError('Private audio storage requires local storage and IndexedDB');
		}
		const database = await openDatabase(indexedDB);
		try {
			await migrateLegacy(database, storageArea);
		} catch (error) {
			database.close();
			throw error;
		}
		return Object.freeze({
			async get(key) {
				const keys = key === null ? null : checkedKeys(key);
				return transact(database, [AUDIO_STORE], 'readonly', (transaction, complete) => {
					const audio = transaction.objectStore(AUDIO_STORE);
					const values = {};
					complete(values);
					if (keys === null) {
						const cursor = audio.openCursor();
						cursor.onsuccess = () => {
							if (!cursor.result) return;
							if (isAudioKey(cursor.result.key)) values[cursor.result.key] = cursor.result.value;
							cursor.result.continue();
						};
					} else {
						for (const item of keys) {
							const request = audio.get(item);
							request.onsuccess = () => {
								if (request.result !== undefined) values[item] = request.result;
							};
						}
					}
				});
			},
			async set(entries) {
				if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
					throw new TypeError('Audio storage entries must be an object');
				}
				const keys = checkedKeys(Object.keys(entries));
				await transact(database, [AUDIO_STORE], 'readwrite', transaction => {
					const audio = transaction.objectStore(AUDIO_STORE);
					for (const key of keys) audio.put(entries[key], key);
				});
			},
			async remove(key) {
				const keys = checkedKeys(key);
				await transact(database, [AUDIO_STORE], 'readwrite', transaction => {
					const audio = transaction.objectStore(AUDIO_STORE);
					for (const item of keys) audio.delete(item);
				});
			}
		});
	}

	const api = { DATABASE_NAME, DATABASE_VERSION, create, isAudioKey };
	root.SoundAdjusterAudioStorage = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
