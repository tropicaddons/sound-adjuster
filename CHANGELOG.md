# Changelog

## 2.6.0 — 2026-10-16

- Added a power button to turn audio adjustments on or off across all tabs while keeping your settings. Your last choice is remembered, and the button can be hidden in Settings.
- Improved Remember so the last applied settings are saved even if you close the popup immediately after a change.
- Improved volume consistency when pausing, resuming, and returning to autoplaying videos.
- Made audio controls more responsive on pages with many media players.
- Disabling Sound Adjuster on a site now applies to its other open regular tabs.
- Added clearer playback warnings and a reload option to restore audio when a player switches to an unsupported source.
- Preserved unsaved changes in Settings when saved profiles are updated elsewhere.

Reload existing media tabs after updating. Website access must be enabled for automatic audio adjustments.

## 2.5.3 — 2026-10-08

- Restored the **Remember** switch and reliable saving and restoring of site settings.
- Fixed audio controls stopping during long video feeds, including pages that keep older players running in the background.
- Kept gain, balance, equalizer, mono, and channel-flip settings working when players or embedded frames are replaced.
- Improved detection of embedded players and players inside shadow roots.
- Kept the **…** menu available when no media is detected, with access to Settings and diagnostics.
- Preserved local protection for saved settings and separation between normal and private windows.

Reload existing media tabs after updating. Sound Adjuster needs website access in Firefox to detect and control media. The additional scripting permission lets it restore its packaged audio-control script in an embedded player that did not receive it automatically.

## 2.5.2 — 2026-10-06

Sound Adjuster 2.5.2 improves audio reliability, local privacy, and the Default Audio controls.

### What’s new
- Added **Clear saved audio data** in Settings. Remove remembered sites, named profiles, global defaults, and disabled sites while keeping your appearance preferences.
- Improved local protection for saved audio settings and separation between normal and private windows.
- Removed unnecessary permissions and limited resource use on pages with many media players.

### Fixes
- The **Default Audio → Enabled** switch now saves immediately. Turn it off and Reset returns to the original audio settings without another Save click.
- Improved audio recovery when media players are removed and added again.
- Fixed cases where multiple players could interfere with audio controls or simultaneous changes could overwrite saved profiles and disabled sites.
- Diagnostics no longer include hostnames or custom profile names.

### Saved settings
Existing audio settings migrate automatically on this device. After clearing saved audio data, reload open media tabs. If you downgrade to an older version, your saved audio settings may appear missing.
