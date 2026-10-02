'use strict';

function readPreferredTheme() {
	try {
		return globalThis.localStorage?.getItem('soundAdjusterTheme') || 'dark';
	} catch (error) {
		return 'dark';
	}
}

function applyPreferredTheme() {
	document.documentElement.classList.toggle('light-theme', readPreferredTheme() === 'light');
}

applyPreferredTheme();
globalThis.addEventListener('storage', event => {
	if (event.key === 'soundAdjusterTheme') applyPreferredTheme();
});
document.addEventListener('visibilitychange', () => {
	if (!document.hidden) applyPreferredTheme();
});

const exceptionsList = document.querySelector('.exceptions-list');
const emptyMessage = document.querySelector('.empty-message');
const clearButton = document.querySelector('.clear-button');
const statusText = document.querySelector('.options-status');
const defaultsEnabled = document.querySelector('.defaults-enabled');
const defaultsFields = document.querySelector('.defaults-fields');
const defaultGain = document.querySelector('.default-gain');
const defaultPan = document.querySelector('.default-pan');
const defaultPreset = document.querySelector('.default-preset');
const defaultMono = document.querySelector('.default-mono');
const defaultFlip = document.querySelector('.default-flip');
const saveDefaultsButton = document.querySelector('.save-defaults');
const defaultsStatus = document.querySelector('.defaults-status');
const editShortcutsButton = document.querySelector('.edit-shortcuts');

const equalizerPresets = {
	flat: { eqBass: 0, eqLowMid: 0, eqMid: 0, eqHighMid: 0, eqTreble: 0 },
	rock: { eqBass: 4, eqLowMid: 2, eqMid: -1, eqHighMid: 2, eqTreble: 3 },
	pop: { eqBass: 2, eqLowMid: 1, eqMid: 3, eqHighMid: 2, eqTreble: 1 },
	classical: { eqBass: 3, eqLowMid: 2, eqMid: -1, eqHighMid: -2, eqTreble: 2 },
	jazz: { eqBass: 3, eqLowMid: 1, eqMid: -1, eqHighMid: 1, eqTreble: 2 },
	bassBoost: { eqBass: 6, eqLowMid: 3, eqMid: -2, eqHighMid: -1, eqTreble: 0 },
	vocal: { eqBass: -2, eqLowMid: 3, eqMid: 5, eqHighMid: 3, eqTreble: -1 },
	dance: { eqBass: 5, eqLowMid: 2, eqMid: 1, eqHighMid: 4, eqTreble: 4 }
};
const { normalizeSettings } = globalThis.SoundAdjusterPopupState;
let loadedGlobalSettings = normalizeSettings({});

function setDefaultsStatus(text, state = 'idle') {
	defaultsStatus.textContent = text;
	defaultsStatus.dataset.state = state;
}

function matchingPreset(settings) {
	for (const [name, preset] of Object.entries(equalizerPresets)) {
		if (Object.entries(preset).every(([key, value]) => settings[key] === value)) return name;
	}
	return 'custom';
}

function updateDefaultsAvailability() {
	defaultsFields.classList.toggle('is-disabled', !defaultsEnabled.checked);
	defaultsFields.querySelectorAll('input, select').forEach(control => {
		control.disabled = !defaultsEnabled.checked;
	});
}

function renderGlobalSettings(result) {
	const settings = normalizeSettings(result?.settings || {});
	loadedGlobalSettings = settings;
	defaultsEnabled.checked = result?.enabled === true;
	defaultGain.value = String(settings.gain);
	defaultPan.value = String(settings.pan);
	defaultMono.checked = settings.mono;
	defaultFlip.checked = settings.flip;
	defaultPreset.value = matchingPreset(settings);
	updateDefaultsAvailability();
}

async function loadGlobalSettings() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'getGlobalSettings' });
		renderGlobalSettings(result);
		setDefaultsStatus('');
	} catch (error) {
		console.warn('Unable to load default audio settings:', error);
		setDefaultsStatus('Couldn’t load default settings.', 'error');
	}
}

function readGlobalSettings() {
	const preset = equalizerPresets[defaultPreset.value] || {
		eqBass: loadedGlobalSettings.eqBass,
		eqLowMid: loadedGlobalSettings.eqLowMid,
		eqMid: loadedGlobalSettings.eqMid,
		eqHighMid: loadedGlobalSettings.eqHighMid,
		eqTreble: loadedGlobalSettings.eqTreble
	};
	return normalizeSettings({
		gain: defaultGain.value,
		pan: defaultPan.value,
		mono: defaultMono.checked,
		flip: defaultFlip.checked,
		...preset
	});
}

async function loadShortcutLabels() {
	try {
		const commands = await browser.commands.getAll();
		for (const command of commands) {
			const row = document.querySelector(`[data-command="${command.name}"]`);
			if (row) row.querySelector('kbd').textContent = command.shortcut || 'Not set';
		}
	} catch (error) {
		console.warn('Unable to load keyboard shortcuts:', error);
	}
}

function setStatus(text, state = 'idle') {
	statusText.textContent = text;
	statusText.dataset.state = state;
}

async function loadExceptions() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'listSiteExceptions' });
		renderExceptions(result?.sites || []);
		setStatus('');
	} catch (error) {
		console.warn('Unable to load site exceptions:', error);
		setStatus('Couldn’t load site exceptions.', 'error');
	}
}

async function removeException(siteKey, button) {
	button.disabled = true;
	try {
		const result = await browser.runtime.sendMessage({
			action: 'removeSiteExceptionByKey',
			siteKey
		});
		renderExceptions(result?.sites || []);
		setStatus(`${siteKey} was enabled. Reload an open tab to reconnect Sound Adjuster.`);
	} catch (error) {
		console.warn('Unable to remove the site exception:', error);
		button.disabled = false;
		setStatus(`Couldn’t enable ${siteKey}.`, 'error');
	}
}

function renderExceptions(sites) {
	exceptionsList.replaceChildren();
	emptyMessage.hidden = sites.length !== 0;
	clearButton.hidden = sites.length === 0;

	for (const siteKey of sites) {
		const row = document.createElement('li');
		row.className = 'exception-row';

		const label = document.createElement('span');
		label.className = 'site-key';
		label.textContent = siteKey;
		label.title = siteKey;

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.className = 'remove-button';
		removeButton.textContent = 'Remove';
		removeButton.setAttribute('aria-label', `Remove ${siteKey} from site exceptions`);
		removeButton.addEventListener('click', () => removeException(siteKey, removeButton));

		row.append(label, removeButton);
		exceptionsList.appendChild(row);
	}
}

clearButton.addEventListener('click', async () => {
	if (!confirm('Enable Sound Adjuster on every disabled site?')) return;
	clearButton.disabled = true;
	try {
		await browser.runtime.sendMessage({ action: 'clearSiteExceptions' });
		renderExceptions([]);
		setStatus('All site exceptions were removed. Reload open tabs to reconnect Sound Adjuster.');
	} catch (error) {
		console.warn('Unable to clear site exceptions:', error);
		setStatus('Couldn’t clear site exceptions.', 'error');
	} finally {
		clearButton.disabled = false;
	}
});

defaultsEnabled.addEventListener('change', updateDefaultsAvailability);
saveDefaultsButton.addEventListener('click', async () => {
	saveDefaultsButton.disabled = true;
	setDefaultsStatus('Saving…');
	try {
		const result = await browser.runtime.sendMessage({
			action: 'saveGlobalSettings',
			enabled: defaultsEnabled.checked,
			settings: readGlobalSettings()
		});
		renderGlobalSettings(result);
		setDefaultsStatus(result?.enabled ? 'Defaults saved.' : 'Global defaults are off.');
	} catch (error) {
		console.warn('Unable to save default audio settings:', error);
		setDefaultsStatus('Couldn’t save default settings.', 'error');
	} finally {
		saveDefaultsButton.disabled = false;
	}
});

editShortcutsButton.addEventListener('click', async () => {
	try {
		await browser.commands.openShortcutSettings();
	} catch (error) {
		console.warn('Unable to open Firefox shortcut settings:', error);
	}
});

browser.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local') return;
	if (changes['soundAdjuster.siteExceptions.v1']) loadExceptions();
	if (changes['soundAdjuster.globalSettings.v1']) loadGlobalSettings();
});

loadExceptions();
loadGlobalSettings();
loadShortcutLabels();
