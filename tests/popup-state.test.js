'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
	DEFAULT_SETTINGS,
	applySettingsToControls,
	bindWheelAdjustment,
	readSettingsFromControls,
	restoreEqualizerExpanded,
	setEqualizerExpanded,
	stepSettingValue
} = require('../popup-state.js');

class FakeWheelTarget {
	addEventListener(type, listener, options) {
		assert.equal(type, 'wheel');
		this.listener = listener;
		this.options = options;
	}

	wheel(deltaY, deltaMode = 0) {
		let prevented = false;
		this.listener({
			deltaMode,
			deltaY,
			preventDefault() {
				prevented = true;
			}
		});
		return prevented;
	}
}

const PRESETS = {
	flat: { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
	rock: { bass: 4, lowMid: 2, mid: -1, highMid: 2, treble: 3 }
};

class FakeClassList {
	constructor() {
		this.classes = new Set();
	}

	toggle(name, force) {
		if (force) this.classes.add(name);
		else this.classes.delete(name);
	}

	contains(name) {
		return this.classes.has(name);
	}
}

function createPopupControls() {
	const selectors = new Map();
	const addInput = selector => {
		const input = { value: '', checked: false, parentElement: null };
		selectors.set(selector, input);
		return input;
	};

	addInput('.element-gain');
	addInput('.element-gain-num');
	addInput('.element-pan');
	addInput('.element-pan-num');
	addInput('.element-mono');
	addInput('.element-flip');
	const equalizerSection = {
		classList: new FakeClassList()
	};
	equalizerSection.classList.toggle('collapsed', true);
	selectors.set('.equalizer-section', equalizerSection);
	selectors.set('.equalizer-toggle', { title: '' });

	for (const selector of [
		'.element-eq-bass',
		'.element-eq-lowmid',
		'.element-eq-mid',
		'.element-eq-highmid',
		'.element-eq-treble'
	]) {
		const display = { textContent: '' };
		const input = addInput(selector);
		input.parentElement = {
			querySelector(displaySelector) {
				return displaySelector === '.band-value' ? display : null;
			}
		};
		input.display = display;
	}

	const presetButtons = Object.keys(PRESETS).map(name => ({
		name,
		classList: new FakeClassList(),
		getAttribute(attribute) {
			return attribute === 'data-preset' ? name : null;
		}
	}));

	return {
		querySelector(selector) {
			return selectors.get(selector) || null;
		},
		querySelectorAll(selector) {
			return selector === '.preset-btn' ? presetButtons : [];
		},
		selectors,
		presetButtons
	};
}

function createStorage() {
	const values = new Map();
	return {
		getItem(key) {
			return values.has(key) ? values.get(key) : null;
		},
		setItem(key, value) {
			values.set(key, String(value));
		}
	};
}

function snapshot(controls) {
	const get = selector => controls.selectors.get(selector);
	return {
		gain: get('.element-gain').value,
		gainNumber: get('.element-gain-num').value,
		pan: get('.element-pan').value,
		panNumber: get('.element-pan-num').value,
		mono: get('.element-mono').checked,
		flip: get('.element-flip').checked,
		eqValues: [
			get('.element-eq-bass').value,
			get('.element-eq-lowmid').value,
			get('.element-eq-mid').value,
			get('.element-eq-highmid').value,
			get('.element-eq-treble').value
		],
		dbLabels: [
			get('.element-eq-bass').display.textContent,
			get('.element-eq-lowmid').display.textContent,
			get('.element-eq-mid').display.textContent,
			get('.element-eq-highmid').display.textContent,
			get('.element-eq-treble').display.textContent
		],
		activePreset: controls.presetButtons.find(button => button.classList.contains('active'))?.name || null
	};
}

test('all applied settings are restored after the popup is recreated', () => {
	const settings = {
		gain: 2.35,
		pan: -0.4,
		mono: true,
		flip: true,
		eqBass: 4,
		eqLowMid: 2,
		eqMid: -1,
		eqHighMid: 2,
		eqTreble: 3
	};

	const firstPopup = createPopupControls();
	const firstResult = applySettingsToControls(firstPopup, settings, PRESETS);
	const firstSnapshot = snapshot(firstPopup);

	const reopenedPopup = createPopupControls();
	const reopenedResult = applySettingsToControls(reopenedPopup, settings, PRESETS);

	assert.equal(firstResult.presetName, 'rock');
	assert.equal(reopenedResult.presetName, 'rock');
	assert.deepEqual(snapshot(reopenedPopup), firstSnapshot);
	assert.deepEqual(firstSnapshot, {
		gain: '2.35',
		gainNumber: '2.35',
		pan: '-0.4',
		panNumber: '-0.4',
		mono: true,
		flip: true,
		eqValues: ['4', '2', '-1', '2', '3'],
		dbLabels: ['+4dB', '+2dB', '-1dB', '+2dB', '+3dB'],
		activePreset: 'rock'
	});
});

test('custom equalizer values do not select a preset', () => {
	const controls = createPopupControls();
	const result = applySettingsToControls(controls, { eqBass: 1 }, PRESETS);

	assert.equal(result.presetName, null);
	assert.equal(snapshot(controls).activePreset, null);
});

test('invalid values are clamped or replaced with safe defaults', () => {
	const controls = createPopupControls();
	applySettingsToControls(controls, {
		gain: 50,
		pan: 'invalid',
		mono: 'true',
		flip: true,
		eqBass: -50,
		eqTreble: 100
	}, PRESETS);

	const state = snapshot(controls);
	assert.equal(state.gain, '5');
	assert.equal(state.gainNumber, '5.00');
	assert.equal(state.pan, '0');
	assert.equal(state.mono, false);
	assert.equal(state.flip, true);
	assert.equal(state.eqValues[0], '-20');
	assert.equal(state.eqValues[4], '20');
});

test('wheel steps preserve each control’s precision and supported range', () => {
	assert.equal(stepSettingValue('gain', 1, 1), 1.05);
	assert.equal(stepSettingValue('gain', 1.23, 1), 1.28);
	assert.equal(stepSettingValue('gain', 5, 1), 5);
	assert.equal(stepSettingValue('gain', 10, 1), 5);
	assert.equal(stepSettingValue('pan', 0, -1), -0.05);
	assert.equal(stepSettingValue('pan', 0.95, 1), 1);
	assert.equal(stepSettingValue('pan', -1, -1), -1);
	assert.equal(stepSettingValue('eqBass', 4, 1), 5);
	assert.equal(stepSettingValue('eqTreble', -20, -1), -20);
	assert.equal(stepSettingValue('eqMid', 20, 1), 20);
});

test('wheel binding prevents page scroll and accumulates small trackpad deltas', () => {
	const target = new FakeWheelTarget();
	let value = 1;
	bindWheelAdjustment(target, 'gain', () => value, nextValue => {
		value = nextValue;
	});

	assert.deepEqual(target.options, { passive: false });
	assert.equal(target.wheel(-12), true);
	assert.equal(value, 1);
	assert.equal(target.wheel(-12), true);
	assert.equal(value, 1.05);
	assert.equal(target.wheel(100), true);
	assert.equal(value, 1);
	assert.equal(target.wheel(-1, 1), true);
	assert.equal(value, 1.05);
});

test('reset restores every control and marks the flat preset', () => {
	const controls = createPopupControls();
	applySettingsToControls(controls, {
		gain: 3,
		pan: 1,
		mono: true,
		flip: true,
		eqBass: 4
	}, PRESETS);

	const result = applySettingsToControls(controls, DEFAULT_SETTINGS, PRESETS);
	const state = snapshot(controls);

	assert.equal(result.presetName, 'flat');
	assert.equal(state.gain, '1');
	assert.equal(state.pan, '0');
	assert.equal(state.mono, false);
	assert.equal(state.flip, false);
	assert.deepEqual(state.eqValues, ['0', '0', '0', '0', '0']);
	assert.deepEqual(state.dbLabels, ['0dB', '0dB', '0dB', '0dB', '0dB']);
	assert.equal(state.activePreset, 'flat');
});

test('settings are read and normalized from all popup controls', () => {
	const controls = createPopupControls();
	applySettingsToControls(controls, {
		gain: 2.75,
		pan: -0.6,
		mono: true,
		flip: true,
		eqBass: 7,
		eqLowMid: 3,
		eqMid: -2,
		eqHighMid: 4,
		eqTreble: 6
	}, PRESETS);

	assert.deepEqual(readSettingsFromControls(controls), {
		gain: 2.75,
		pan: -0.6,
		mono: true,
		flip: true,
		eqBass: 7,
		eqLowMid: 3,
		eqMid: -2,
		eqHighMid: 4,
		eqTreble: 6
	});
});

test('the expanded equalizer panel is restored after the popup is recreated', () => {
	const storage = createStorage();
	const firstPopup = createPopupControls();
	setEqualizerExpanded(firstPopup, true, storage);

	assert.equal(firstPopup.querySelector('.equalizer-section').classList.contains('collapsed'), false);
	assert.equal(firstPopup.querySelector('.equalizer-toggle').title, 'Close Equalizer');

	const reopenedPopup = createPopupControls();
	const expanded = restoreEqualizerExpanded(reopenedPopup, storage);

	assert.equal(expanded, true);
	assert.equal(reopenedPopup.querySelector('.equalizer-section').classList.contains('collapsed'), false);
	assert.equal(reopenedPopup.querySelector('.equalizer-toggle').title, 'Close Equalizer');

	setEqualizerExpanded(reopenedPopup, false, storage);
	const thirdPopup = createPopupControls();
	assert.equal(restoreEqualizerExpanded(thirdPopup, storage), false);
	assert.equal(thirdPopup.querySelector('.equalizer-section').classList.contains('collapsed'), true);
	assert.equal(thirdPopup.querySelector('.equalizer-toggle').title, 'Open Equalizer');
});
