'use strict';

// Register listeners synchronously on every service worker start.
importScripts(
  'extension-api.js',
  'popup-state.js',
  'site-profiles.js',
  'site-exceptions.js',
  'named-profiles.js',
  'global-settings.js',
  'audio-storage.js',
  'background.js',
  'capture-worker.js'
);
