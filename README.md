# Sound Adjuster

Sound Adjuster is a Firefox extension for changing the volume, stereo balance, and equalizer settings of audio and video on the current page.

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?logo=buy-me-a-coffee&logoColor=000000)](https://buymeacoffee.com/tropicaddons)

## Screenshots

| Dark theme | Light theme |
| --- | --- |
| ![Sound Adjuster dark theme](docs/screenshots/dark-theme.png) | ![Sound Adjuster light theme](docs/screenshots/light-theme.png) |

## Features

- Volume gain from 0× to 5×
- Left and right stereo balance
- Five-band equalizer with presets
- Mono and channel-flip controls
- Optional per-site profiles that restore settings after page reloads
- Light and dark themes
- Automatic detection of media added after the page loads
- Reliable audio recovery when an autoplay feed video is unmuted

## Site profiles

Turn on **Remember site** at the bottom of the controls to store the current gain, pan, mono, channel-flip, and equalizer settings for the active site. The switch itself reflects whether the profile is active; extra text appears only if storage fails. The profile is applied before the first media scan after a page reload, including media added later.

Profiles are opt-in, stay on the local machine, and are never synchronized or used for tracking. Private windows and non-HTTP(S) pages do not read or write profiles. Turning the switch off removes the saved profile without changing the sound in the current tab.

## Changelog

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

The extension works with standard HTML audio and video elements. Some sites use cross-origin media or DRM that Firefox does not allow extensions to process safely. In those cases, Sound Adjuster leaves the original playback unchanged and displays an availability message.

## Support

Sound Adjuster is free and open source. If you find it useful, you can [support its continued development](https://buymeacoffee.com/tropicaddons).

## License

[MIT](LICENSE)
