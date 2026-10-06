# Sound Adjuster

Sound Adjuster is a privacy-friendly, open-source Firefox extension for boosting and shaping tab audio with up to 5× gain, stereo balance, and a five-band equalizer. Save your preferred settings for individual sites or as global defaults, and adjust audio without opening the popup using keyboard shortcuts.

[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-blue?logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Support-FFDD00?logo=buy-me-a-coffee&logoColor=000000)](https://buymeacoffee.com/tropicaddons)

[Website and interactive demo](https://sound-adjuster.github.io/) · [Listening guides](https://sound-adjuster.github.io/guides.html)

The demo lets you try the controls before installing. It processes a sample in your browser; its settings are separate from the extension.

## Features

- Volume gain from 0× to 5×
- Live level/clipping indicator beside the gain value
- Left and right stereo balance
- Five-band equalizer with presets
- Mono and channel-flip controls
- Optional per-site profiles that restore settings after page reloads
- Optional global defaults for gain, balance, equalizer, mono, and channel flip
- Multiple named profiles for each site, with instant switching from the popup
- Per-site disable list with a dedicated exceptions manager
- One-click local diagnostics copy without media URLs
- Light and dark themes shared by the popup and settings page
- Automatic detection of media added after the page loads
- Reliable audio recovery when an autoplay feed video is unmuted
- Keyboard shortcuts for gain, reset, and mono controls
- Toolbar badge for the active gain, mono, balance, or disabled state

## Settings

Open the popup's footer menu (**…**) and choose **Settings and exceptions**. The settings page brings together default audio settings, keyboard shortcuts, appearance preferences, and your disabled-site list.

Under **Default audio settings**, enable global defaults, choose your gain, stereo balance, equalizer preset, mono, and channel flip, then select **Save defaults**. These become the starting settings on supported sites without a remembered site profile. A remembered site profile takes priority; global defaults are not read in private windows.

The **Enabled** switch saves immediately, including the currently displayed values. Turning it off makes Reset use the original audio settings without a separate Save click. After editing values, select **Save defaults**.

**Reset** and the reset shortcut return to your enabled global defaults, including every equalizer band. With global defaults off (or in a private window), they restore 1× gain, centered balance, Flat EQ, and mono/channel flip off. If **Remember** is on, the reset settings also replace that site's remembered settings.

The settings page follows the light or dark theme selected in the popup. Under **Appearance**, turn off **Show support button** to hide the support heart permanently. The preference stays on your device, and the GitHub link remains available.

Under **Local audio data**, choose **Clear saved audio data** to remove remembered settings, named profiles, global defaults, and site exceptions. Appearance preferences remain. Saved audio data stays until you delete it or uninstall the extension. Reload existing media tabs after clearing data. In private windows, the settings page disables audio data controls and does not load normal-window saved settings.

## Keyboard shortcuts

Control the active tab without opening the popup:

| Action | Default shortcut |
| --- | --- |
| Increase gain | `Alt+Up` |
| Decrease gain | `Alt+Down` |
| Reset audio | `Alt+Shift+0` |
| Toggle mono | `Alt+Shift+M` |

The **Keyboard shortcuts** section in Settings shows your currently assigned keys. Choose **Edit shortcuts** to open Firefox's extension shortcut settings and change them. Shortcut changes to the audio also update the popup while it is open and the toolbar badge.

## Gain and level feedback

The gain range is 0×–5×. The compact level indicator beside the gain value warns when the audio approaches clipping. Increasing gain can cause distortion; it does not restore detail missing from a quiet or distorted recording.

## Site profiles

Turn on **Remember** in the footer to store the current gain, pan, mono, channel-flip, and equalizer settings for the active site. The switch reflects whether the profile is active; extra text appears only after an action or if storage fails. The profile is applied before the first media scan after a page reload, including media added later.

Remembered settings and named profiles stay on the local machine and are never synchronized or used for tracking. Private windows and non-HTTP(S) pages do not read or write profiles. Turning off the switch removes the automatically restored settings without changing the sound in the current tab.

HTTP and HTTPS addresses and the matching `www.` hostname continue to share profiles and exceptions. Firefox keeps audio records in extension-origin IndexedDB, separate from content-script storage. Existing records migrate automatically; appearance preferences remain in local extension storage. Older versions do not read this new audio store, so downgrading can make saved settings appear missing.

Open the footer menu and choose **Profiles** to save or switch complete audio setups for the active site. Each site can have up to 12 named profiles containing gain, pan, mono, channel flip, and every equalizer band. The profile screen opens in the same menu without changing the popup size. **Default** restores the original settings, **Save current…** stores the controls as they are, and **Manage profiles** lets you remove saved entries. Selecting a profile remains temporary unless **Remember** is enabled.

## Site exceptions and diagnostics

Choose **Disable on this site** from the footer menu to add the current hostname to the local exceptions list. Existing processing is neutralized immediately; after the tab reloads, Sound Adjuster skips creating an audio graph on that site. Manage or remove disabled sites from **Settings and exceptions**.

**Copy diagnostics** copies the extension version, capability summary, media count, current settings, and browser information. It omits hostnames, page paths, media source URLs, and custom profile names.

## Install from source

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Choose `manifest.json` from the project folder.

Temporary add-ons are removed when Firefox closes.

## Compatibility

The extension works with standard HTML audio and video elements. Some sites use cross-origin media or protected playback that Firefox does not allow extensions to process safely. In those cases, Sound Adjuster leaves playback unchanged and explains why its audio controls are unavailable.

Each frame shares one audio context and processes at most 32 media elements at once. Tracking is limited to 128 elements per frame and 64 frames per tab; a frame can create at most 64 native media sources before reload. Excess elements retain native playback, with limited controls. Removing media releases its processing nodes; reinserting the same element reuses its source. These bounds limit resource exhaustion on pages that continuously create media. If disabled-site preferences cannot be read, processing waits until a successful retry or reload.

## Support

Sound Adjuster is free and open source. If you find it useful, you can [support its continued development](https://buymeacoffee.com/tropicaddons).

## License

[MIT](LICENSE)
