'use strict';

(function initializePopupState(root) {
	const DEFAULT_SETTINGS = Object.freeze({
		gain: 1,
		pan: 0,
		mono: false,
		flip: false,
		eqBass: 0,
		eqLowMid: 0,
		eqMid: 0,
		eqHighMid: 0,
		eqTreble: 0
	});

	const SETTING_RANGES = Object.freeze({
		gain: [0, 5],
		pan: [-1, 1],
		eqBass: [-20, 20],
		eqLowMid: [-20, 20],
		eqMid: [-20, 20],
		eqHighMid: [-20, 20],
		eqTreble: [-20, 20]
	});

	const EQ_CONTROLS = Object.freeze([
		{ setting: 'eqBass', preset: 'bass', selector: '.element-eq-bass' },
		{ setting: 'eqLowMid', preset: 'lowMid', selector: '.element-eq-lowmid' },
		{ setting: 'eqMid', preset: 'mid', selector: '.element-eq-mid' },
		{ setting: 'eqHighMid', preset: 'highMid', selector: '.element-eq-highmid' },
		{ setting: 'eqTreble', preset: 'treble', selector: '.element-eq-treble' }
	]);
	const EQUALIZER_EXPANDED_STORAGE_KEY = 'soundAdjusterEqualizerExpanded';

	function normalizeNumber(value, fallback, min, max) {
		const parsed = Number.parseFloat(value);
		if (!Number.isFinite(parsed)) return fallback;
		return Math.max(min, Math.min(max, parsed));
	}

	function normalizeSettings(settings = {}) {
		const normalized = { ...DEFAULT_SETTINGS };

		for (const [name, range] of Object.entries(SETTING_RANGES)) {
			normalized[name] = normalizeNumber(
				settings?.[name],
				DEFAULT_SETTINGS[name],
				range[0],
				range[1]
			);
		}

		normalized.mono = settings?.mono === true;
		normalized.flip = settings?.flip === true;
		return normalized;
	}

	function formatDb(value) {
		return value > 0 ? `+${value}dB` : `${value}dB`;
	}

	function findMatchingPreset(settings, presets) {
		const normalized = normalizeSettings(settings);
		for (const [presetName, preset] of Object.entries(presets || {})) {
			const matches = EQ_CONTROLS.every(control => (
				Number.parseFloat(preset?.[control.preset]) === normalized[control.setting]
			));
			if (matches) return presetName;
		}
		return null;
	}

	function updatePresetButtons(container, settings, presets) {
		const presetName = findMatchingPreset(settings, presets);
		container.querySelectorAll('.preset-btn').forEach(button => {
			button.classList.toggle(
				'active',
				button.getAttribute('data-preset') === presetName
			);
		});
		return presetName;
	}

	function applySettingsToControls(container, settings, presets) {
		const normalized = normalizeSettings(settings);
		const gain = container.querySelector('.element-gain');
		const gainNumber = container.querySelector('.element-gain-num');
		const pan = container.querySelector('.element-pan');
		const panNumber = container.querySelector('.element-pan-num');
		const mono = container.querySelector('.element-mono');
		const flip = container.querySelector('.element-flip');

		if (gain) gain.value = String(normalized.gain);
		if (gainNumber) gainNumber.value = String(normalized.gain);
		if (pan) pan.value = String(normalized.pan);
		if (panNumber) panNumber.value = String(normalized.pan);
		if (mono) mono.checked = normalized.mono;
		if (flip) flip.checked = normalized.flip;

		for (const controlInfo of EQ_CONTROLS) {
			const control = container.querySelector(controlInfo.selector);
			if (!control) continue;
			const value = normalized[controlInfo.setting];
			control.value = String(value);
			const display = control.parentElement?.querySelector('.band-value');
			if (display) display.textContent = formatDb(value);
		}

		return {
			settings: normalized,
			presetName: updatePresetButtons(container, normalized, presets)
		};
	}

	function readSettingsFromControls(container) {
		return normalizeSettings({
			gain: container.querySelector('.element-gain')?.value,
			pan: container.querySelector('.element-pan')?.value,
			mono: container.querySelector('.element-mono')?.checked === true,
			flip: container.querySelector('.element-flip')?.checked === true,
			eqBass: container.querySelector('.element-eq-bass')?.value,
			eqLowMid: container.querySelector('.element-eq-lowmid')?.value,
			eqMid: container.querySelector('.element-eq-mid')?.value,
			eqHighMid: container.querySelector('.element-eq-highmid')?.value,
			eqTreble: container.querySelector('.element-eq-treble')?.value
		});
	}

	function updateEqualizerView(container, expanded) {
		const section = container.querySelector('.equalizer-section');
		const toggle = container.querySelector('.equalizer-toggle');
		if (section) section.classList.toggle('collapsed', !expanded);
		if (toggle) toggle.title = expanded ? 'Close Equalizer' : 'Open Equalizer';
		return expanded;
	}

	function restoreEqualizerExpanded(container, storage) {
		let expanded = false;
		try {
			expanded = storage?.getItem(EQUALIZER_EXPANDED_STORAGE_KEY) === 'true';
		} catch (error) {
			console.warn('Unable to restore the equalizer panel state:', error);
		}
		return updateEqualizerView(container, expanded);
	}

	function setEqualizerExpanded(container, expanded, storage) {
		const normalized = expanded === true;
		updateEqualizerView(container, normalized);
		try {
			storage?.setItem(EQUALIZER_EXPANDED_STORAGE_KEY, String(normalized));
		} catch (error) {
			console.warn('Unable to save the equalizer panel state:', error);
		}
		return normalized;
	}

	const api = {
		DEFAULT_SETTINGS,
		applySettingsToControls,
		findMatchingPreset,
		normalizeSettings,
		readSettingsFromControls,
		restoreEqualizerExpanded,
		setEqualizerExpanded,
		updatePresetButtons
	};

	root.SoundAdjusterPopupState = api;
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
