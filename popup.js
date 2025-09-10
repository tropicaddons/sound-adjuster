'use strict';

// Modern UI Elements
let tid = 0;
const frameMap = new Map();
const allElements = document.getElementById('all-elements');
const elementsTpl = document.getElementById('elements-tpl');
const themeToggle = document.getElementById('theme-toggle');

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

// Theme Management
function initializeTheme() {
	const savedTheme = localStorage.getItem('soundAdjusterTheme') || 'dark';
	document.body.classList.toggle('light-theme', savedTheme === 'light');
	updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
	const isLightTheme = document.body.classList.contains('light-theme');
	themeToggle.textContent = isLightTheme ? '🌙' : '☀️';
	themeToggle.title = isLightTheme ? 'Switch to Dark Mode' : 'Switch to Light Mode';
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

// Demo mode for testing UI when no media is found
function showDemoMode() {
	console.log("🎭 Showing demo mode - no real media found");
	const node = document.createElement('div');
	node.appendChild(document.importNode(elementsTpl.content, true));

	// Style as demo
	node.style.opacity = '0.7';
	node.style.position = 'relative';
	node.querySelector('.element-label').innerHTML = `
		<span class="element-type">🎵 Demo Audio</span>
		<span class="element-info">
			<span class="frame-badge">Demo</span>
			<span class="playing-indicator">▶️</span>
		</span>
	`;

	const gain = node.querySelector('.element-gain');
	const gainNumberInput = node.querySelector('.element-gain-num');
	gain.value = 1;
	gainNumberInput.value = '1';
	gain.style.display = 'inline-block';
	gain.style.width = '100%';
	gain.addEventListener('input', function () {
		console.log(`🎚️ Demo gain changed to: ${this.value}`);
		this.parentElement.querySelector('.element-gain-num').value = '' + this.value;
	});
	gainNumberInput.addEventListener('input', function () {
		if (+this.value > +this.getAttribute('max')) this.value = this.getAttribute('max');
		if (+this.value < +this.getAttribute('min')) this.value = this.getAttribute('min');
		this.parentElement.querySelector('.element-gain').value = '' + this.value;
		console.log(`🔢 Demo gain input changed to: ${this.value}`);
	});

	const pan = node.querySelector('.element-pan');
	const panNumberInput = node.querySelector('.element-pan-num');
	pan.value = 0;
	panNumberInput.value = '0';
	pan.style.display = 'inline-block';
	pan.style.width = '100%';
	pan.addEventListener('input', function () {
		console.log(`🎚️ Demo pan changed to: ${this.value}`);
		this.parentElement.querySelector('.element-pan-num').value = '' + this.value;
	});
	panNumberInput.addEventListener('input', function () {
		if (+this.value > +this.getAttribute('max')) this.value = this.getAttribute('max');
		if (+this.value < +this.getAttribute('min')) this.value = this.getAttribute('min');
		this.parentElement.querySelector('.element-pan').value = '' + this.value;
		console.log(`🔢 Demo pan input changed to: ${this.value}`);
	});

	const mono = node.querySelector('.element-mono');
	mono.addEventListener('change', _ => {
		console.log(`🎵 Demo mono changed to: ${mono.checked}`);
	});

	const flip = node.querySelector('.element-flip');
	flip.addEventListener('change', _ => {
		console.log(`🔄 Demo flip changed to: ${flip.checked}`);
	});

	// Demo equalizer controls
	const eqBass = node.querySelector('.element-eq-bass');
	const eqLowMid = node.querySelector('.element-eq-lowmid');
	const eqMid = node.querySelector('.element-eq-mid');
	const eqHighMid = node.querySelector('.element-eq-highmid');
	const eqTreble = node.querySelector('.element-eq-treble');

	if (eqBass) {
		eqBass.value = 0;
		eqBass.addEventListener('input', function () {
			console.log(`🎛️ Demo bass changed to: ${this.value}dB`);
			const valueDisplay = this.parentElement.querySelector('.band-value');
			if (valueDisplay) {
				valueDisplay.textContent = this.value > 0 ? `+${this.value}dB` : `${this.value}dB`;
			}
		});
	}

	if (eqLowMid) {
		eqLowMid.value = 0;
		eqLowMid.addEventListener('input', function () {
			console.log(`🎛️ Demo low mid changed to: ${this.value}dB`);
			const valueDisplay = this.parentElement.querySelector('.band-value');
			if (valueDisplay) {
				valueDisplay.textContent = this.value > 0 ? `+${this.value}dB` : `${this.value}dB`;
			}
		});
	}

	if (eqMid) {
		eqMid.value = 0;
		eqMid.addEventListener('input', function () {
			console.log(`🎛️ Demo mid changed to: ${this.value}dB`);
			const valueDisplay = this.parentElement.querySelector('.band-value');
			if (valueDisplay) {
				valueDisplay.textContent = this.value > 0 ? `+${this.value}dB` : `${this.value}dB`;
			}
		});
	}

	if (eqHighMid) {
		eqHighMid.value = 0;
		eqHighMid.addEventListener('input', function () {
			console.log(`🎛️ Demo high mid changed to: ${this.value}dB`);
			const valueDisplay = this.parentElement.querySelector('.band-value');
			if (valueDisplay) {
				valueDisplay.textContent = this.value > 0 ? `+${this.value}dB` : `${this.value}dB`;
			}
		});
	}

	if (eqTreble) {
		eqTreble.value = 0;
		eqTreble.addEventListener('input', function () {
			console.log(`🎛️ Demo treble changed to: ${this.value}dB`);
			const valueDisplay = this.parentElement.querySelector('.band-value');
			if (valueDisplay) {
				valueDisplay.textContent = this.value > 0 ? `+${this.value}dB` : `${this.value}dB`;
			}
		});
	}

	node.querySelector('.element-reset').onclick = function () {
		gain.value = 1;
		gainNumberInput.value = '1';
		pan.value = 0;
		panNumberInput.value = '0';
		mono.checked = false;
		flip.checked = false;

		// Reset equalizer
		if (eqBass) eqBass.value = 0;
		if (eqLowMid) eqLowMid.value = 0;
		if (eqMid) eqMid.value = 0;
		if (eqHighMid) eqHighMid.value = 0;
		if (eqTreble) eqTreble.value = 0;

	// Update all value displays
	node.querySelectorAll('.band-value').forEach(display => {
		display.textContent = '0dB';
	});

	// Reset preset buttons in demo
	const demoPresetButtons = node.querySelectorAll('.preset-btn');
	demoPresetButtons.forEach(btn => btn.classList.remove('active'));

	console.log("🔄 Demo reset clicked");
	};

	// Demo equalizer toggle
	const demoEqToggle = node.querySelector('.equalizer-toggle');
	const demoEqSection = node.querySelector('.equalizer-section');

	if (demoEqToggle && demoEqSection) {
		demoEqToggle.addEventListener('click', function () {
			const isCollapsed = demoEqSection.classList.toggle('collapsed');
			// Update toggle button title only (icon handled by CSS)
			if (isCollapsed) {
				this.title = 'Open Equalizer';
			} else {
				this.title = 'Close Equalizer';
			}
			console.log(`🎛️ Demo equalizer ${isCollapsed ? 'collapsed' : 'expanded'}`);
		});
	}

	// Demo preset buttons
	const demoPresetButtons = node.querySelectorAll('.preset-btn');
	demoPresetButtons.forEach(button => {
		button.addEventListener('click', function () {
			const presetName = this.getAttribute('data-preset');
			const preset = equalizerPresets[presetName];

			if (!preset) return;

			console.log(`🎛️ Demo preset: ${presetName}`, preset);

			// Update demo slider values
			if (eqBass) eqBass.value = preset.bass;
			if (eqLowMid) eqLowMid.value = preset.lowMid;
			if (eqMid) eqMid.value = preset.mid;
			if (eqHighMid) eqHighMid.value = preset.highMid;
			if (eqTreble) eqTreble.value = preset.treble;

			// Update demo value displays
			node.querySelectorAll('.band-value').forEach((display, index) => {
				const values = [preset.bass, preset.lowMid, preset.mid, preset.highMid, preset.treble];
				const value = values[index];
				display.textContent = value > 0 ? `+${value}dB` : `${value}dB`;
			});

			// Update active preset button
			demoPresetButtons.forEach(btn => btn.classList.remove('active'));
			this.classList.add('active');
  });
});

	allElements.appendChild(node);
}

function applySettings(fid, elid, newSettings) {
	console.log(`🎚️ Applying settings to element ${elid} in frame ${fid}:`, newSettings);
	return browser.tabs.sendMessage(tid, {
		action: "applySettings",
		elid: elid,
		settings: newSettings
	}, { frameId: fid }).then(result => {
		console.log(`✅ Settings applied successfully to element ${elid}`);
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

browser.tabs.query({ currentWindow: true, active: true }).then(tabs => {
	tid = tabs[0].id;
	console.log(`🎯 Active tab ID: ${tid}, URL: ${tabs[0].url}`);
	return scanMedia().then(frameResults => {
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
			console.log("⚠️ No media elements found - showing demo mode");
			showDemoMode();
		} else {
			console.log(`🎉 Found ${elCount} media elements total`);
			const node = document.createElement('div');
			node.appendChild(document.importNode(elementsTpl.content, true));
			node.querySelector('.element-label').textContent = `All media (${elCount} elements)`;

			const gain = node.querySelector('.element-gain');
			const gainNumberInput = node.querySelector('.element-gain-num');
			gain.value = 1;
			gainNumberInput.value = '1';
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
			gain.addEventListener('input', _ => applyGain(gain.value));
			gainNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max');
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min');
				applyGain(+this.value);
			});

			const pan = node.querySelector('.element-pan');
			const panNumberInput = node.querySelector('.element-pan-num');
			pan.value = 0;
			panNumberInput.value = '0';
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
			mono.checked = false;
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
			flip.checked = false;
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

			if (eqBass) eqBass.value = 0;
			if (eqLowMid) eqLowMid.value = 0;
			if (eqMid) eqMid.value = 0;
			if (eqHighMid) eqHighMid.value = 0;
			if (eqTreble) eqTreble.value = 0;

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
				eqToggle.addEventListener('click', function () {
					const isCollapsed = eqSection.classList.toggle('collapsed');
					// Update toggle button title only (icon handled by CSS)
					if (isCollapsed) {
						this.title = 'Open Equalizer';
					} else {
						this.title = 'Close Equalizer';
					}
					console.log(`🎛️ Equalizer ${isCollapsed ? 'collapsed' : 'expanded'}`);
				});
			}

			// Equalizer preset functionality
			const presetButtons = node.querySelectorAll('.preset-btn');
			let activePreset = null;

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
				gain.value = 1;
				gain.parentElement.querySelector('.element-gain-num').value = '' + gain.value;
				pan.value = 0;
				pan.parentElement.querySelector('.element-pan-num').value = '' + pan.value;
				mono.checked = false;
				flip.checked = false;

				// Reset equalizer
				if (eqBass) eqBass.value = 0;
				if (eqLowMid) eqLowMid.value = 0;
				if (eqMid) eqMid.value = 0;
				if (eqHighMid) eqHighMid.value = 0;
				if (eqTreble) eqTreble.value = 0;

				// Update all value displays
				node.querySelectorAll('.band-value').forEach(display => {
					display.textContent = '0dB';
				});

				// Reset active preset
				presetButtons.forEach(btn => btn.classList.remove('active'));
				activePreset = null;

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
	}).catch(err => {
		console.error('❌ Error scanning media:', err);
		allElements.innerHTML = `
			<div style="text-align: center; padding: 20px;">
				<h3 style="color: var(--warning-color); margin-bottom: 10px;">⚠️ Scan Error</h3>
				<p style="margin: 0; font-size: 0.9em; opacity: 0.8;">
					Unable to scan media elements on this page.
				</p>
				<p style="margin: 10px 0 0 0; font-size: 0.8em; opacity: 0.6;">
					Error: ${err.message}
				</p>
			</div>
		`;
	});
});