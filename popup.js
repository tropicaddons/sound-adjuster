'use strict';

// Modern UI Elements
let tid = 0;
const frameMap = new Map();
let referenceMediaKey = null;
const allElements = document.getElementById('all-elements');
const elementsTpl = document.getElementById('elements-tpl');
const themeToggle = document.getElementById('theme-toggle');
let noMediaStateVisible = false;
let autoMediaScanTimer = null;
let autoMediaScanInFlight = false;
const AUTO_MEDIA_SCAN_INTERVAL_MS = 700;

// Equalizer Presets
const equalizerPresets = {
	flat: { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
	rock: { bass: 4, lowMid: 2, mid: -1, highMid: 2, treble: 3 },
	pop: { bass: 2, lowMid: 1, mid: 3, highMid: 2, treble: 1 },
	classical: { bass: 3, lowMid: 2, mid: -1, highMid: -2, treble: 2 },
	jazz: { bass: 3, lowMid: 1, mid: -1, highMid: 1, treble: 2 },
	bassBoost: { bass: 6, lowMid: 3, mid: -2, highMid: -1, treble: 0 },
	vocal: { bass: -2, lowMid: 3, mid: 5, highMid: 3, treble: -1 },
	dance: { bass: 5, lowMid: 2, mid: 1, highMid: 4, treble: 4 }
};

const {
	DEFAULT_SETTINGS: POPUP_DEFAULT_SETTINGS,
	applySettingsToControls,
	restoreEqualizerExpanded,
	setEqualizerExpanded,
	updatePresetButtons
} = globalThis.SoundAdjusterPopupState;

// Theme Management
function initializeTheme() {
	const savedTheme = localStorage.getItem('soundAdjusterTheme') || 'dark';
	document.body.classList.toggle('light-theme', savedTheme === 'light');
	updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
	const isLightTheme = document.body.classList.contains('light-theme');
	themeToggle.textContent = isLightTheme ? '☾' : '☼';
	themeToggle.title = isLightTheme ? 'Switch to Dark Mode' : 'Switch to Light Mode';
	themeToggle.setAttribute('aria-label', themeToggle.title);
}

function toggleTheme() {
	document.body.classList.toggle('light-theme');
	const isLightTheme = document.body.classList.contains('light-theme');
	localStorage.setItem('soundAdjusterTheme', isLightTheme ? 'light' : 'dark');
	updateThemeToggleIcon();
}

// Initialize theme on load
initializeTheme();
themeToggle.addEventListener('click', toggleTheme);

function createEmptyState(titleText, descriptionText) {
	const emptyState = document.createElement('div');
	emptyState.className = 'empty-state';

	const title = document.createElement('h2');
	title.textContent = titleText;

	const description = document.createElement('p');
	description.textContent = descriptionText;

	const reloadButton = document.createElement('button');
	reloadButton.type = 'button';
	reloadButton.className = 'reload-button';
	reloadButton.textContent = '↻';
	reloadButton.title = 'Scan again';
	reloadButton.setAttribute('aria-label', 'Scan again');
	reloadButton.addEventListener('click', () => scanForNewMedia());

	emptyState.appendChild(title);
	emptyState.appendChild(description);
	emptyState.appendChild(reloadButton);
	return emptyState;

}

function showNoMediaState() {
	noMediaStateVisible = true;
	allElements.innerHTML = '';
	allElements.classList.add('is-empty');
	allElements.appendChild(createEmptyState(
		'No media available',
		'Start playing audio or video. It will appear here automatically.'
	));
	scheduleAutoMediaScan();
}

function showUnavailableMediaState(capability) {
	const descriptions = {
		'site-restricted': 'This site restricts direct audio processing. Playback is left unchanged.',
		'cross-origin-media': 'This media is protected by cross-origin security. Playback is left unchanged.',
		'protected-media': 'Protected media cannot be processed safely. Playback is left unchanged.',
		'audio-graph-failed': 'Firefox could not create a safe audio connection for this media.',
		'web-audio-unavailable': 'Advanced audio processing is not available for this media.'
	};

	noMediaStateVisible = false;
	stopAutoMediaScan();
	allElements.innerHTML = '';
	allElements.classList.add('is-empty');
	allElements.appendChild(createEmptyState(
		'Audio boost unavailable',
		descriptions[capability?.reason] || 'This media cannot be processed safely. Playback is left unchanged.'
	));
}

function applySettings(fid, elid, newSettings) {
	console.log(`🎚️ Applying settings to element ${elid} in frame ${fid}:`, newSettings);
	return browser.tabs.sendMessage(tid, {
		action: "applySettings",
		elid: elid,
		settings: newSettings
	}, { frameId: fid }).then(result => {
		const capability = result?.capability;
		if (`${fid}:${elid}` === referenceMediaKey && capability && capability.mode !== 'full' && capability.mode !== 'pending') {
			showUnavailableMediaState(capability);
		}
		return result;
	}).catch(err => {
		console.error(`❌ Failed to apply settings to element ${elid}:`, err);
		throw err;
	});
}

function scanMedia() {
	console.log("🔍 Scanning media elements...");
	return browser.webNavigation.getAllFrames({ tabId: tid }).then(frames => {
		console.log(`📋 Found ${frames.length} frames to scan`);
		return Promise.all(frames.map(frame =>
			browser.tabs.sendMessage(tid, { action: "scanMedia" }, { frameId: frame.frameId })
			.then(result => {
				console.log(`✅ Frame ${frame.frameId}: Found ${result && result.media ? Object.keys(result.media).length : 0} media elements`);
				return {
					frameId: frame.frameId,
					media: result ? result.media : {}
				};
			}).catch(err => {
				console.warn(`❌ Frame ${frame.frameId}:`, err.message);
				return { frameId: frame.frameId, media: {} };
			})
		));
	});
}

function countScannedMedia(frameResults) {
	return frameResults.reduce((count, frameResult) => (
		count + Object.keys(frameResult.media || {}).length
	), 0);
}

function stopAutoMediaScan() {
	clearTimeout(autoMediaScanTimer);
	autoMediaScanTimer = null;
}

function scheduleAutoMediaScan(delay = AUTO_MEDIA_SCAN_INTERVAL_MS) {
	if (!noMediaStateVisible || autoMediaScanTimer !== null) return;
	autoMediaScanTimer = setTimeout(() => {
		autoMediaScanTimer = null;
		scanForNewMedia();
	}, delay);
}

async function scanForNewMedia() {
	if (!noMediaStateVisible || autoMediaScanInFlight) return;
	autoMediaScanInFlight = true;

	try {
		const frameResults = await scanMedia();
		if (noMediaStateVisible && countScannedMedia(frameResults) > 0) {
			noMediaStateVisible = false;
			stopAutoMediaScan();
			renderFrameResults(frameResults);
		}
	} catch (error) {
		console.warn('Automatic media scan failed:', error);
	} finally {
		autoMediaScanInFlight = false;
		if (noMediaStateVisible) scheduleAutoMediaScan();
	}
}

function renderFrameResults(frameResults) {
		console.log("📊 Frame scan results:", frameResults);
		let elCount = 0;

		// Clear existing frame map
		frameMap.clear();

		// Process results from all frames - collect all media for global control
		for (const frameResult of frameResults) {
			const fid = frameResult.frameId;
			const mediaMap = new Map(Object.entries(frameResult.media || {}));
			frameMap.set(fid, mediaMap);
			elCount += mediaMap.size; // Count total elements
		}

		if (elCount == 0) {
			console.log("No media elements found - showing empty state");
			showNoMediaState();
		} else {
			noMediaStateVisible = false;
			stopAutoMediaScan();
			console.log(`🎉 Found ${elCount} media elements total`);
			const scannedMedia = [];
			for (const [fid, mediaMap] of frameMap) {
				for (const [elid, media] of mediaMap) {
					scannedMedia.push({ fid, elid, media });
				}
			}

			const referenceEntry = scannedMedia.find(entry => entry.media.isPlaying) || scannedMedia[0];
			const referenceMedia = referenceEntry.media;
			referenceMediaKey = `${referenceEntry.fid}:${referenceEntry.elid}`;

			if (referenceMedia.capability?.mode === 'basic' || referenceMedia.capability?.mode === 'unsupported') {
				showUnavailableMediaState(referenceMedia.capability);
				return;
			}

			const node = document.createElement('div');
			node.appendChild(document.importNode(elementsTpl.content, true));
			node.querySelector('.element-label').textContent = `All media (${elCount} elements)`;

			// The popup is destroyed whenever it is closed. Restore every control
			// from the content script, where the active media settings remain alive.
			const restoredUiState = applySettingsToControls(
				node,
				referenceMedia?.settings,
				equalizerPresets
			);

			const gain = node.querySelector('.element-gain');
			const gainNumberInput = node.querySelector('.element-gain-num');
			gain.style.display = 'inline-block';
			gain.style.width = '100%';
			function applyGain (value) {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { gain: value });
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`);
						if (egain) {
							egain.value = value;
							egain.parentElement.querySelector('.element-gain-num').value = '' + value;
						}
					}
				}
				gain.value = value;
				gainNumberInput.value = '' + value;
			}
			gain.addEventListener('input', _ => applyGain(+gain.value));
			gainNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max');
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min');
				applyGain(+this.value);
			});

			const pan = node.querySelector('.element-pan');
			const panNumberInput = node.querySelector('.element-pan-num');
			pan.style.display = 'inline-block';
			pan.style.width = '100%';
			function applyPan (value) {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { pan: value });
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`);
						if (epan) {
							epan.value = value;
							epan.parentElement.querySelector('.element-pan-num').value = '' + value;
						}
					}
				}
				pan.value = value;
				panNumberInput.value = '' + value;
			}
			pan.addEventListener('input', _ => applyPan(pan.value));
			panNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max');
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min');
				applyPan(+this.value);
			});

			const mono = node.querySelector('.element-mono');
			mono.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { mono: mono.checked });
						const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`);
						if (emono) emono.checked = mono.checked;
					}
				}
			});

			const flip = node.querySelector('.element-flip');
			flip.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { flip: flip.checked });
						const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`);
						if (eflip) eflip.checked = flip.checked;
					}
				}
			});

			// Equalizer controls for all elements
			const eqBass = node.querySelector('.element-eq-bass');
			const eqLowMid = node.querySelector('.element-eq-lowmid');
			const eqMid = node.querySelector('.element-eq-mid');
			const eqHighMid = node.querySelector('.element-eq-highmid');
			const eqTreble = node.querySelector('.element-eq-treble');

			function currentEqualizerSettings() {
				return {
					eqBass: Number.parseFloat(eqBass?.value),
					eqLowMid: Number.parseFloat(eqLowMid?.value),
					eqMid: Number.parseFloat(eqMid?.value),
					eqHighMid: Number.parseFloat(eqHighMid?.value),
					eqTreble: Number.parseFloat(eqTreble?.value)
				};
			}

			// Add global equalizer event listeners
			const setupGlobalEqControl = (element, band) => {
				if (!element) return;
				element.addEventListener('input', function () {
					const value = parseInt(this.value);
					const setting = {};
					setting[band] = value;

					// Apply to all elements
					for (const [fid, els] of frameMap) {
						for (const [elid, el] of els) {
							applySettings(fid, elid, setting);
							// Update individual controls
							const eElement = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-${band.replace('eq', 'eq-')}`);
							if (eElement) eElement.value = value;
						}
					}

					// Update value display
					const valueDisplay = this.parentElement.querySelector('.band-value');
					if (valueDisplay) {
						valueDisplay.textContent = value > 0 ? `+${value}dB` : `${value}dB`;
					}

					activePreset = updatePresetButtons(
						node,
						currentEqualizerSettings(),
						equalizerPresets
					);
				});
			};

			setupGlobalEqControl(eqBass, 'eqBass');
			setupGlobalEqControl(eqLowMid, 'eqLowMid');
			setupGlobalEqControl(eqMid, 'eqMid');
			setupGlobalEqControl(eqHighMid, 'eqHighMid');
			setupGlobalEqControl(eqTreble, 'eqTreble');

			// Equalizer toggle functionality
			const eqToggle = node.querySelector('.equalizer-toggle');
			const eqSection = node.querySelector('.equalizer-section');

			if (eqToggle && eqSection) {
				restoreEqualizerExpanded(node, localStorage);
				eqToggle.addEventListener('click', function () {
					const expanded = setEqualizerExpanded(
						node,
						eqSection.classList.contains('collapsed'),
						localStorage
					);
					console.log(`🎛️ Equalizer ${expanded ? 'expanded' : 'collapsed'}`);
				});
			}

			// Equalizer preset functionality
			const presetButtons = node.querySelectorAll('.preset-btn');
			let activePreset = restoredUiState.presetName;

			presetButtons.forEach(button => {
				button.addEventListener('click', function () {
					const presetName = this.getAttribute('data-preset');
					const preset = equalizerPresets[presetName];

					if (!preset) return;

					console.log(`🎛️ Applying equalizer preset: ${presetName}`, preset);

					// Update slider values
					if (eqBass) eqBass.value = preset.bass;
					if (eqLowMid) eqLowMid.value = preset.lowMid;
					if (eqMid) eqMid.value = preset.mid;
					if (eqHighMid) eqHighMid.value = preset.highMid;
					if (eqTreble) eqTreble.value = preset.treble;

					// Update value displays
					node.querySelectorAll('.band-value').forEach((display, index) => {
						const values = [preset.bass, preset.lowMid, preset.mid, preset.highMid, preset.treble];
						const value = values[index];
						display.textContent = value > 0 ? `+${value}dB` : `${value}dB`;
					});

					// Apply preset to all elements
					for (const [fid, els] of frameMap) {
						for (const [elid, el] of els) {
							applySettings(fid, elid, {
								eqBass: preset.bass,
								eqLowMid: preset.lowMid,
								eqMid: preset.mid,
								eqHighMid: preset.highMid,
								eqTreble: preset.treble
							});
						}
					}

					// Update active preset button
					presetButtons.forEach(btn => btn.classList.remove('active'));
					this.classList.add('active');
					activePreset = presetName;
  });
});

			node.querySelector('.element-reset').onclick = function () {
				const resetUiState = applySettingsToControls(
					node,
					POPUP_DEFAULT_SETTINGS,
					equalizerPresets
				);
				activePreset = resetUiState.presetName;

				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`);
						if (egain) {
							egain.value = 1;
							egain.parentElement.querySelector('.element-gain-num').value = '' + egain.value;
						}
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`);
						if (epan) {
							epan.value = 0;
							epan.parentElement.querySelector('.element-pan-num').value = '' + epan.value;
						}
						const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`);
						if (emono) emono.checked = false;
						const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`);
						if (eflip) eflip.checked = false;
						applySettings(fid, elid, {
							gain: 1, pan: 0, mono: false, flip: false,
							eqBass: 0, eqLowMid: 0, eqMid: 0, eqHighMid: 0, eqTreble: 0
						});
					}
				}
			};
			allElements.appendChild(node);
		}
	}

browser.runtime.onMessage.addListener((message, sender) => {
	if (message?.action !== 'mediaElementsChanged' || !noMediaStateVisible) return undefined;
	if (sender.tab?.id !== tid) return undefined;

	stopAutoMediaScan();
	scheduleAutoMediaScan(0);
	return undefined;
});

window.addEventListener('unload', stopAutoMediaScan);

browser.tabs.query({ currentWindow: true, active: true }).then(tabs => {
	tid = tabs[0].id;
	console.log(`🎯 Active tab ID: ${tid}, URL: ${tabs[0].url}`);
	return scanMedia().then(frameResults => {
		renderFrameResults(frameResults);
	}).catch(err => {
		console.error('❌ Error scanning media:', err);
		noMediaStateVisible = false;
		stopAutoMediaScan();
		allElements.innerHTML = '';
		allElements.classList.add('is-empty');
		allElements.appendChild(createEmptyState(
			'Unable to scan this page',
			'The page may not allow extension access. Try again after reloading it.'
		));
	});
});
