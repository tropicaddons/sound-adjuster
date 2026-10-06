# Changelog

## 2.5.2 — 2026-10-06

Sound Adjuster 2.5.2 improves local data protection and reliability, and fixes the Default Audio Enabled switch.

### Fixed
- Turning off **Default Audio → Enabled** now saves immediately. Reset restores 1× gain, centered balance, Flat EQ, and mono/channel flip off without an extra Save click. If saving fails, the switch returns to its previously saved state and shows an error.
- Media elements are identified internally, so duplicate or malformed page attributes no longer merge or break audio controls.
- Concurrent profile and disabled-site writes are serialized to prevent lost updates.
- Removing a player releases its processing nodes; reinserting the same player reuses its audio source.

### Privacy and safeguards
- Firefox audio records now live in extension-origin IndexedDB, separate from content-script storage. Existing records migrate locally; appearance preferences are preserved.
- Strengthened extension message validation and private-window separation. If disabled-site preferences cannot be read, audio processing stays off until a successful retry or reload.
- Removed unnecessary `tabs` and `activeTab` permissions and tightened the extension-page Content Security Policy. Automatic media detection still requires access to supported websites.
- Added **Clear saved audio data** in Settings to remove remembered sites, named profiles, global defaults, and site exceptions while preserving appearance preferences. Reload open media tabs after clearing.
- Diagnostics omit hostnames and custom profile names.

### Compatibility notes
- Gain remains 0–5×, with the existing EQ and no limiter. HTTP/HTTPS and matching `www.` addresses continue to share profiles and exceptions.
- Processing is bounded to 32 active audio graphs and 128 tracked media elements per frame, 64 native media sources over a frame's lifetime, and 64 frames per tab. Excess players use native playback or limited controls; long-running feeds may require a reload. Very large DOM mutation batches may need another scan to detect later players.
- Older extension versions cannot read the new audio store after downgrading. No settings or audio are uploaded.

### Verification and installation
Validated with 107 Node tests and 22 silent checks in Firefox 157.0 using a disposable profile. These checks cover real audio nodes, defaults/Reset/Remember, named profiles, private windows, storage migration/deletion, site exceptions, and the production shortcut handlers. Physical keyboard shortcuts, protected-media sites, fullscreen, and signed-store upgrades need separate acceptance checks.

The attached ZIP is the unsigned Firefox package for source installation or AMO submission. **AMO 2.5.2 submission/signing is pending**; the [Firefox Add-ons listing](https://addons.mozilla.org/firefox/addon/sound-adjuster/) may still offer 2.5.1 until the new version is approved. Regular Firefox installation requires Mozilla's signed package.
