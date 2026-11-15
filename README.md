# Sound Adjuster

Turn up quiet videos, balance your headphones, and fine-tune audio in your browser. Sound Adjuster is a free, open-source extension for Firefox and Chrome. Audio runs locally, and saved settings stay on your device.

## Download

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster/"><img src=".github/readme/firefox-add-on.png" alt="Get Sound Adjuster from Firefox Add-ons" height="45"></a>
  &nbsp;
  <a href="https://github.com/tropicaddons/sound-adjuster/releases/tag/chrome-v2.6.0"><img src=".github/readme/download-for-chrome.svg" alt="Download Sound Adjuster for Chrome from GitHub" height="45"></a>
</p>

<p align="center">Chrome ZIP · <a href="#chrome">Manual installation</a></p>

### Firefox

Open Firefox Add-ons and click **Add to Firefox**.

### Chrome

1. On the release page, open **Assets**, download **`sound-adjuster-v2.6.0-chrome.zip`**, and extract it.
2. Enter `chrome://extensions` in Chrome's address bar and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder that contains `manifest.json`.
4. Open Chrome's **Extensions** menu and pin **Sound Adjuster** for easy access.

[Try the interactive demo](https://sound-adjuster.github.io/) · [Read the listening guides](https://sound-adjuster.github.io/guides.html)

## What you can do

- **Adjust volume from 0× to 5×.** Watch the level indicator beside the gain control for clipping when you turn up the volume.
- **Shape the sound.** Use the five-band equalizer and its presets, move the stereo balance left or right, switch to mono, or swap the left and right channels.
- **Save a setup for each site.** Turn on **Remember**, save named profiles, or set global defaults for sites without a remembered profile.
- **Make quick adjustments.** Use keyboard shortcuts or check the toolbar badge for the current gain, balance, mono, or disabled state.

## Save and manage your settings

Open the popup's **…** menu and choose **Settings and exceptions** to manage global defaults, shortcuts, appearance, and sites where Sound Adjuster is disabled.

- **Remember** restores your current gain, balance, EQ, mono, and channel settings on that site after a reload. Turning it off removes the saved automatic settings while keeping the current tab's sound.
- **Profiles** lets you save and switch between up to 12 named setups per site. Use **Save current…** to save a setup and **Manage profiles** to remove one. Switching profiles is temporary unless **Remember** is on.
- **Default audio settings** sets the starting sound for supported sites without a remembered profile. The **Enabled** switch saves the displayed values immediately. Use **Save defaults** when editing the controls afterward.
- **Reset** restores your enabled global defaults, including each EQ band. With defaults off or in a private window, it restores 1× gain, centered balance, Flat EQ, with mono and channel flip off. When **Remember** is on, Reset also updates the site's saved settings.
- **Power** turns sound adjustments on or off across tabs. Sound Adjuster starts on, and your last choice persists across browser restarts. While power is off, your settings stay saved and Reset and audio shortcuts are inactive.
- **Disable on this site** turns off adjustments in regular open tabs for the current site. Manage disabled sites from **Settings and exceptions**.

Under **Appearance**, you can hide the power or support button. The settings page follows the light or dark theme selected in the popup.

## Keyboard shortcuts

| Action | Default shortcut |
| --- | --- |
| Increase gain | `Alt+Up` |
| Decrease gain | `Alt+Down` |
| Reset audio | `Alt+Shift+0` |
| Toggle mono | `Alt+Shift+M` |

Open **Settings and exceptions → Keyboard shortcuts** to see your assigned keys. Choose **Edit shortcuts** to change them in your browser.

## Playback compatibility

Sound Adjuster can adjust standard HTML audio and video players, including players that load after the page opens. Some embedded or protected players need different handling depending on the browser.

- **Firefox.** Allow website access in the extension's permissions so Sound Adjuster can find players. If the browser restricts audio processing on a player, the popup explains why the controls are unavailable. If a player switches sources and goes silent, use **Reload to restore audio**. This reloads the page and pauses adjustments for that load while keeping saved settings.
- **Chrome.** For players that need tab audio mode, open Sound Adjuster from the toolbar once in each new tab. If capture does not start, choose **Adjust tab audio** in the popup. While adjusting tab audio, use the player's full-screen button to hide Chrome's address bar and tabs. Choose **Stop tab audio** to return to the tab's original output. Support for protected playback depends on the browser and playback setup.

## Privacy and troubleshooting

Saved profiles, global defaults, and site exceptions stay on your device. Private windows do not load saved profiles or global defaults. Firefox and Chrome installations keep separate records. HTTP and HTTPS URLs and their matching `www.` hostnames share profiles and exceptions.

- **Clear saved audio data** removes remembered settings, named profiles, global defaults, and site exceptions. Appearance preferences stay saved. Reload existing media tabs after clearing the data or updating the extension.
- **Copy diagnostics** copies browser and extension information, a media count, and current settings. It leaves out hostnames, page paths, media URLs, and custom profile names.

## Source and support

<details>
<summary>Load the Firefox version from source</summary>

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on** and choose `manifest.json` from the project folder.

Temporary add-ons are removed when Firefox closes. Firefox 2.6.0 automatically migrates existing audio settings to its extension database. If you downgrade, older versions may not see settings in the new database.

</details>

[Chrome source branch](https://github.com/tropicaddons/sound-adjuster/tree/chrome-2.6.0) · [Report an issue](https://github.com/tropicaddons/sound-adjuster/issues) · [Support development](https://buymeacoffee.com/tropicaddons) · [MIT license](LICENSE)
