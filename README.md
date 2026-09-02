# Sound Adjuster

Sound Adjuster is a Firefox extension for changing the volume, stereo balance, and equalizer settings of audio and video on the current page.

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?logo=buy-me-a-coffee&logoColor=000000)](https://buymeacoffee.com/tropicaddons)

## Features

- Volume gain from 0× to 5×
- Left and right stereo balance
- Five-band equalizer with presets
- Mono and channel-flip controls
- Optional per-site profiles that restore settings after page reloads
- Multiple named profiles for each site, with instant switching from the popup
- Per-site disable list with a dedicated exceptions manager
- One-click local diagnostics copy without media URLs
- Light and dark themes
- Automatic detection of media added after the page loads
- Reliable audio recovery when an autoplay feed video is unmuted

## Site profiles

Turn on **Remember** in the footer to store the current gain, pan, mono, channel-flip, and equalizer settings for the active site. The checkbox reflects whether the profile is active; extra text appears only after an action or if storage fails. The profile is applied before the first media scan after a page reload, including media added later.

Remembered settings and named profiles stay on the local machine and are never synchronized or used for tracking. Private windows and non-HTTP(S) pages do not read or write profiles. Clearing the checkbox removes the automatically restored settings without changing the sound in the current tab.

Open the footer menu and choose **Profiles** to save or switch complete audio setups for the active site. Each site can have up to 12 named profiles containing gain, pan, mono, channel flip, and every equalizer band. The profile screen opens in the same menu without changing the popup size. **Default** restores the original settings, **Save current…** stores the controls as they are, and **Manage profiles** lets you remove saved entries. Selecting a profile remains temporary unless **Remember** is enabled.

## Site exceptions and diagnostics

Choose **Disable on this site** from the footer menu to add the current hostname to the local exceptions list. Existing processing is neutralized immediately; after the tab reloads, Sound Adjuster skips creating an audio graph on that site. **Manage site exceptions** opens a separate page where disabled sites can be removed individually or cleared together.

**Copy diagnostics** copies the extension version, hostname, capability summary, media count, current settings, and browser information. It does not include the page path or media source URLs.

## Changelog

### 2.4.1

Changes since 2.4.0:

- Added site-specific named profiles for complete gain, balance, channel, and equalizer setups, with quick switching and profile management from the popup.
- Added a persistent per-site disable list and a separate exceptions page for restoring access later.
- Added a local diagnostics copy action that leaves out page paths and media source URLs.
- Reworked the footer with the active hostname, **Remember** control, and a right-aligned menu that stays within the existing popup dimensions.
- Added mouse-wheel adjustment to the Gain and Pan rows and each equalizer band while preserving their existing limits and precision.
- Simplified the Gain value field and corrected the displayed equalizer frequencies to match the filters used by the audio engine.
- Improved restricted-media messages so CORS, protected playback, and site limitations are easier to identify while original playback remains unchanged.

### 2.4.0

Changes since 2.3.2:

- Added opt-in per-site profiles for gain, pan, mono, channel flip, and all equalizer bands.
- Restored remembered settings before the first media scan and applied them to media added later on dynamic feed pages.
- Improved autoplay-feed reliability by resuming suspended audio processing when media is unmuted or begins playing.
- Refined the popup with a compact profile switch, a familiar Reset action in the **All media** header, and immediate Equalizer collapse without leftover popup space.
- Added Firefox Manifest V3 background storage handling while keeping private windows and non-HTTP(S) pages outside profile storage.

## Install from source

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Choose `manifest.json` from the project folder.

Temporary add-ons are removed when Firefox closes.

## Compatibility

The extension works with standard HTML audio and video elements. Some sites use cross-origin media or protected playback that Firefox does not allow extensions to process safely. In those cases, Sound Adjuster leaves playback unchanged and explains why its audio controls are unavailable.

## Support

Sound Adjuster is free and open source. If you find it useful, you can [support its continued development](https://buymeacoffee.com/tropicaddons).

## License

[MIT](LICENSE)
