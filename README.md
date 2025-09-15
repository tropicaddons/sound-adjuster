# Sound Adjuster

**Sound Adjuster** is a Firefox browser extension that allows you to control audio levels and stereo balance for individual tabs with advanced media detection and connection strategies.

[![Download on Firefox](https://img.shields.io/badge/Firefox-Download-blue?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster)

---
<img width="382" height="591" alt="{10A73713-D891-4651-86BA-AB374E7C9FD6}" src="https://github.com/user-attachments/assets/08e90021-f9f9-4ced-945f-98b11a4821cb" /> <img width="382" height="591" alt="{6F573D8E-47CE-41BD-BF0C-67A64FC7CBD9}" src="https://github.com/user-attachments/assets/3c4308cd-2132-4890-b8cf-7013c29fc6e8" />



## Features

### 🎵 Core Features
- **Volume Control**: Adjust the audio gain for each tab (0x to 3x).
- **Stereo Balance**: Shift audio to the left or right channel (-1 to +1).
- **Theme Toggle**: Switch between light and dark themes.
- **Equalizer**: Bass, Low Mid, Mid, High Mid, Treble (8 Presets) 

## Supported Platforms

✅ **Works on:**
- YouTube, Kick, Twitch
- Netflix, Disney+
- Prime Video, HBO Max
- Local video files
- Embedded media players
- Custom media player

## Troubleshooting

### If Media Doesn't Work:
1. Refresh the page and try again
3. Try clicking on the video first

## Installation

### From Firefox Add-ons
https://addons.mozilla.org/en-US/firefox/addon/sound-adjuster

## Technical Details

- **Manifest Version**: 2 (Firefox compatible)
- **Permissions**: activeTab, tabs, webNavigation, <all_urls>
- **Web APIs Used**: Web Audio API, MutationObserver, MediaElement
- **Browser Support**: Firefox 57+

## Development

### Project Structure
```
sound-adjuster-main/
├── manifest.json          # Manifest
├── popup.html            # Popup interface
├── popup.js              # Popup functionality
├── content.js            # Content script with audio processing
├── background.js         # Background service worker
├── icon*.png            # Icon
└── README.md            
```

## License
This project is licensed under the **MIT License**.
