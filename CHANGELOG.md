# Changelog

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
