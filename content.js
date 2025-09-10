'use strict';

// Store media elements with their AudioContext setup
let mediaElements = new Map();

// Function to apply audio settings to a specific media element
function applySettings(elid, newSettings) {
  console.log(`🎛️ Applying settings to element ${elid}:`, newSettings);
  const el = document.querySelector(`[data-x-soundfixer-id="${elid}"]`);
  if (!el) {
    console.warn(`⚠️ Element with id ${elid} not found - available elements:`,
      Array.from(document.querySelectorAll('[data-x-soundfixer-id]')).map(e => e.getAttribute('data-x-soundfixer-id')));
    return;
  }

  console.log(`✅ Found element ${elid}, tag: ${el.tagName}, src: ${el.src || el.currentSrc}`);

  // Initialize AudioContext if not already done
  if (!el.xSoundFixerContext) {
    try {
      console.log(`🎵 Creating AudioContext for element ${elid}`);
      el.xSoundFixerContext = new AudioContext();
      el.xSoundFixerGain = el.xSoundFixerContext.createGain();
      el.xSoundFixerPan = el.xSoundFixerContext.createStereoPanner();
      el.xSoundFixerSplit = el.xSoundFixerContext.createChannelSplitter(2);
      el.xSoundFixerMerge = el.xSoundFixerContext.createChannelMerger(2);
      el.xSoundFixerSource = el.xSoundFixerContext.createMediaElementSource(el);
      // Create equalizer filters
      el.xSoundFixerEqBass = el.xSoundFixerContext.createBiquadFilter();
      el.xSoundFixerEqBass.type = 'lowshelf';
      el.xSoundFixerEqBass.frequency.value = 250; // Bass cutoff at 250Hz
      el.xSoundFixerEqBass.gain.value = 0;

      el.xSoundFixerEqLowMid = el.xSoundFixerContext.createBiquadFilter();
      el.xSoundFixerEqLowMid.type = 'peaking';
      el.xSoundFixerEqLowMid.frequency.value = 500; // Low mid at 500Hz
      el.xSoundFixerEqLowMid.Q.value = 1;
      el.xSoundFixerEqLowMid.gain.value = 0;

      el.xSoundFixerEqMid = el.xSoundFixerContext.createBiquadFilter();
      el.xSoundFixerEqMid.type = 'peaking';
      el.xSoundFixerEqMid.frequency.value = 2000; // Mid at 2kHz
      el.xSoundFixerEqMid.Q.value = 1;
      el.xSoundFixerEqMid.gain.value = 0;

      el.xSoundFixerEqHighMid = el.xSoundFixerContext.createBiquadFilter();
      el.xSoundFixerEqHighMid.type = 'peaking';
      el.xSoundFixerEqHighMid.frequency.value = 6000; // High mid at 6kHz
      el.xSoundFixerEqHighMid.Q.value = 1;
      el.xSoundFixerEqHighMid.gain.value = 0;

      el.xSoundFixerEqTreble = el.xSoundFixerContext.createBiquadFilter();
      el.xSoundFixerEqTreble.type = 'highshelf';
      el.xSoundFixerEqTreble.frequency.value = 8000; // Treble cutoff at 8kHz
      el.xSoundFixerEqTreble.gain.value = 0;

      // Connect the audio chain: Source -> EQ Filters -> Gain -> Pan -> Destination
      el.xSoundFixerSource.connect(el.xSoundFixerEqBass);
      el.xSoundFixerEqBass.connect(el.xSoundFixerEqLowMid);
      el.xSoundFixerEqLowMid.connect(el.xSoundFixerEqMid);
      el.xSoundFixerEqMid.connect(el.xSoundFixerEqHighMid);
      el.xSoundFixerEqHighMid.connect(el.xSoundFixerEqTreble);
      el.xSoundFixerEqTreble.connect(el.xSoundFixerGain);
      el.xSoundFixerGain.connect(el.xSoundFixerPan);
      el.xSoundFixerPan.connect(el.xSoundFixerContext.destination);
      el.xSoundFixerOriginalChannels = el.xSoundFixerContext.destination.channelCount;
    } catch (e) {
      console.warn("Failed to create AudioContext for element:", el, e);
      return;
    }
  }

  // Apply settings
  if ('gain' in newSettings) {
    el.xSoundFixerGain.gain.value = newSettings.gain;
  }
  if ('pan' in newSettings) {
    el.xSoundFixerPan.pan.value = newSettings.pan;
  }
  if ('mono' in newSettings) {
    el.xSoundFixerContext.destination.channelCount = newSettings.mono ? 1 : el.xSoundFixerOriginalChannels;
  }
  if ('flip' in newSettings) {
    el.xSoundFixerFlipped = newSettings.flip;
    el.xSoundFixerMerge.disconnect();
    el.xSoundFixerPan.disconnect();
    if (el.xSoundFixerFlipped) {
      el.xSoundFixerPan.connect(el.xSoundFixerSplit);
      el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 0, 1);
      el.xSoundFixerSplit.connect(el.xSoundFixerMerge, 1, 0);
      el.xSoundFixerMerge.connect(el.xSoundFixerContext.destination);
    } else {
      el.xSoundFixerPan.connect(el.xSoundFixerContext.destination);
    }
  }

  // Apply equalizer settings
  if ('eqBass' in newSettings && el.xSoundFixerEqBass) {
    el.xSoundFixerEqBass.gain.value = newSettings.eqBass;
  }
  if ('eqLowMid' in newSettings && el.xSoundFixerEqLowMid) {
    el.xSoundFixerEqLowMid.gain.value = newSettings.eqLowMid;
  }
  if ('eqMid' in newSettings && el.xSoundFixerEqMid) {
    el.xSoundFixerEqMid.gain.value = newSettings.eqMid;
  }
  if ('eqHighMid' in newSettings && el.xSoundFixerEqHighMid) {
    el.xSoundFixerEqHighMid.gain.value = newSettings.eqHighMid;
  }
  if ('eqTreble' in newSettings && el.xSoundFixerEqTreble) {
    el.xSoundFixerEqTreble.gain.value = newSettings.eqTreble;
  }

  // Update stored settings
  el.xSoundFixerSettings = {
    gain: el.xSoundFixerGain.gain.value,
    pan: el.xSoundFixerPan.pan.value,
    mono: el.xSoundFixerContext.destination.channelCount === 1,
    flip: el.xSoundFixerFlipped || false,
    eqBass: el.xSoundFixerEqBass ? el.xSoundFixerEqBass.gain.value : 0,
    eqLowMid: el.xSoundFixerEqLowMid ? el.xSoundFixerEqLowMid.gain.value : 0,
    eqMid: el.xSoundFixerEqMid ? el.xSoundFixerEqMid.gain.value : 0,
    eqHighMid: el.xSoundFixerEqHighMid ? el.xSoundFixerEqHighMid.gain.value : 0,
    eqTreble: el.xSoundFixerEqTreble ? el.xSoundFixerEqTreble.gain.value : 0,
  };
}

// Function to scan for media elements and assign IDs
function scanMediaElements() {
  console.log("🔍 Scanning for media elements...");
  const result = new Map();
  const mediaElements = document.querySelectorAll('video, audio');

  console.log(`📊 Found ${mediaElements.length} media elements on page`);

  for (const el of mediaElements) {
    // Assign unique ID if not already assigned
    if (!el.hasAttribute('data-x-soundfixer-id')) {
      const newId = Math.random().toString(36).substr(2, 10);
      el.setAttribute('data-x-soundfixer-id', newId);
      console.log(`🆔 Assigned ID ${newId} to ${el.tagName}: ${el.src || el.currentSrc || 'no src'}`);
    }

    const elid = el.getAttribute('data-x-soundfixer-id');
    const isPlaying = (el.currentTime > 0 && !el.paused && !el.ended && el.readyState > 2);

    result.set(elid, {
      type: el.tagName.toLowerCase(),
      isPlaying: isPlaying,
      settings: el.xSoundFixerSettings || {
        gain: 1, pan: 0, mono: false, flip: false,
        eqBass: 0, eqLowMid: 0, eqMid: 0, eqHighMid: 0, eqTreble: 0
      }
    });

    console.log(`✅ Media element ${elid}: ${el.tagName} ${isPlaying ? '(playing)' : '(not playing)'}`);
  }

  console.log(`📋 Total media elements processed: ${result.size}`);
  return result;
}

// Message handler
function handleMessage(message, sender, sendResponse) {
  try {
    console.log("📨 Content script received message:", message.action, message);

    switch (message.action) {
      case "scanMedia":
        console.log("🔍 Scanning media elements in current frame...");
        const mediaMap = scanMediaElements();
        console.log(`🎵 Found ${mediaMap.size} media elements`);
        sendResponse({ success: true, media: Object.fromEntries(mediaMap) });
        break;

      case "applySettings":
        console.log(`🎚️ Applying settings to element ${message.elid}:`, message.settings);
        applySettings(message.elid, message.settings);
        sendResponse({ success: true });
        break;

      case "getStatus":
        const mediaMapStatus = scanMediaElements();
        console.log(`📊 Status: ${mediaMapStatus.size} media elements connected`);
        sendResponse({
          success: true,
          status: {
            connectedMediaCount: mediaMapStatus.size
          }
        });
        break;

      default:
        console.warn("⚠️ Unknown action:", message.action);
        sendResponse({ success: false, error: "Unknown action: " + message.action });
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }

  return true; // Keep message channel open for async response
}

// Initialize when DOM is ready
function initialize() {
  console.log("🚀 Initializing Sound Adjuster with AudioContext...");
  console.log("📍 Current URL:", window.location.href);
  console.log("📍 Frame type:", window.self === window.top ? "Main frame" : "Iframe");

  // Scan for initial media elements
  const initialMedia = scanMediaElements();
  console.log(`🎯 Found ${initialMedia.size} media elements initially`);

  // Set up observer for new media elements
  const observer = new MutationObserver((mutations) => {
    let hasNewMedia = false;

    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
              hasNewMedia = true;
            } else if (node.querySelector && node.querySelector('video, audio')) {
              hasNewMedia = true;
            }
          }
        });
      }
    });

    if (hasNewMedia) {
      console.log("New media elements detected, rescanning...");
      scanMediaElements();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Store observer reference
  window.soundAdjusterObserver = observer;

  console.log("✅ Sound Adjuster initialized successfully");
}

// Listen for messages from popup
browser.runtime.onMessage.addListener(handleMessage);

// Start initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}