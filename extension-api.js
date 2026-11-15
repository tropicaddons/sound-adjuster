'use strict';

// Chrome's Promise-based APIs are available on all supported versions.
// Keep the existing Firefox-oriented modules and their storage format intact.
if (!globalThis.browser) globalThis.browser = globalThis.chrome;

globalThis.SoundAdjusterMessaging = Object.freeze({
  addListener(handler) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let response;
      try {
        response = handler(message, sender);
      } catch (error) {
        sendResponse({ success: false, error: error.message });
        return false;
      }
      // Unhandled notifications must not compete with another listener's reply.
      if (response === undefined) return false;
      Promise.resolve(response).then(sendResponse, error => {
        sendResponse({ success: false, error: error.message });
      });
      // Callback contract works before Chrome's Promise listener support too.
      return true;
    });
  }
});

// Blink has no ::-moz-range-progress. Paint the same filled track for all paths:
// input gestures, presets, reset, shortcuts, and restored settings.
if (globalThis.location?.protocol === 'chrome-extension:' && location.pathname === '/popup.html') {
  const refreshRanges = () => {
    for (const input of document.querySelectorAll('input[type="range"]')) {
      const percentage = 100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
      input.style.setProperty('--range-progress', `${percentage}%`);
    }
  };
  document.addEventListener('input', refreshRanges);
  document.addEventListener('DOMContentLoaded', refreshRanges);
  // UI updates can set .value without dispatching an input event.
  const timer = setInterval(refreshRanges, 100);
  window.addEventListener('unload', () => clearInterval(timer), { once: true });
}
