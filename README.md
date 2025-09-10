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

### 🔧 Advanced Features
- **Multi-Strategy Connection**: 4 different connection strategies to handle various media players
- **Smart Media Detection**: Automatically detects video/audio elements across different platforms
- **Dynamic Content Support**: Handles AJAX-loaded and SPA content
- **Cross-Origin Compatibility**: Works with various streaming platforms
- **Real-time Monitoring**: Monitors media state and reconnects when needed
- **Status Diagnostics**: Built-in diagnostic tools for troubleshooting

## Supported Platforms

✅ **Works on:**
- YouTube, Vimeo, Twitch
- Netflix, Hulu, Disney+
- Prime Video, HBO Max
- Local video files
- Embedded media players
- Custom media players

## How to Use

### Basic Usage
1. Click on the extension icon in the browser toolbar.
2. Use the sliders to adjust volume (`Gain`) and stereo balance (`Pan`).
3. Switch between light and dark mode using the toggle button.

### Advanced Usage
- **Status Control**: Click "Durum Kontrolü" to see connection status and media count
- **Force Reconnect**: Use "Yeniden Bağlan" if media stops working
- **Input Box**: Type exact values in the number inputs for precise control

## Troubleshooting

### If Media Doesn't Work:
1. Refresh the page and try again
2. Check browser console for error messages
3. Try clicking on the video first (unlocks AudioContext)

### Common Issues:
- **No Sound**: AudioContext may need user interaction to unlock
- **Video Broken**: Cross-origin policies may prevent direct connection
- **Not Connected**: Some media players use custom implementations

## Connection Strategies

The extension uses 4 different strategies to connect to media:

1. **Direct Connection**: Best for local and same-origin media
2. **Cross-Origin Fallback**: For media from different domains
3. **Web Audio API**: Advanced audio processing pipeline
4. **Volume Manipulation**: Basic volume control when others fail

## Installation

### From Source
1. Download or clone this repository
2. Open Firefox and go to `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select the `manifest.json` file from this folder

### From Firefox Add-ons
*(Coming soon)*

## Technical Details

- **Manifest Version**: 2 (Firefox compatible)
- **Permissions**: activeTab, tabs, webNavigation, <all_urls>
- **Web APIs Used**: Web Audio API, MutationObserver, MediaElement
- **Browser Support**: Firefox 57+

## Development

### Project Structure
```
sound-adjuster-main/
├── manifest.json          # Extension manifest
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── content.js            # Content script with audio processing
├── background.js         # Background service worker
├── icon*.png            # Extension icons
└── README.md            # This file
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on different media platforms
5. Submit a pull request

## License
This project is licensed under the **MIT License**.

## Changelog

### v1.2 (Current)
- 🎯 Advanced media detection and connection strategies
- 🔄 Automatic reconnection for dynamic content
- 📊 Real-time status monitoring and diagnostics
- 🎵 Enhanced audio processing with compressor and analyser
- 🌐 Cross-origin compatibility improvements
- 🛠️ Force reconnect functionality
- 🎨 Improved UI with status controls

### v1.1
- Basic volume and pan controls
- Theme toggle functionality
- Firefox compatibility fixes

### v1.0
- Initial release
- Basic audio manipulation
