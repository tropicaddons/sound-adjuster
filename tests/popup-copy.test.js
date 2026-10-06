'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const popupScript = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const popupMarkup = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const popupStyles = fs.readFileSync(path.join(__dirname, '..', 'popup.css'), 'utf8');
const popupStateScript = fs.readFileSync(path.join(__dirname, '..', 'popup-state.js'), 'utf8');
const contentScript = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const backgroundScript = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const optionsMarkup = fs.readFileSync(path.join(__dirname, '..', 'options.html'), 'utf8');
const optionsScript = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const optionsStyles = fs.readFileSync(path.join(__dirname, '..', 'options.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

test('restricted media copy explains the limitation without implying playback failure', () => {
	assert.match(popupScript, /'Audio controls unavailable'/);
	assert.doesNotMatch(popupScript, /'Audio boost unavailable'/);

	for (const reason of [
		'site-restricted',
		'cross-origin-media',
		'protected-media',
		'audio-graph-failed',
		'web-audio-unavailable'
	]) {
		assert.match(popupScript, new RegExp(`'${reason}':`));
	}

	assert.match(popupScript, /Playback continues normally\./);
});

test('the footer menu exposes diagnostics, site tools, and site-specific named profiles', () => {
	assert.match(popupScript, /Sound Adjuster diagnostics/);
	assert.match(popupScript, /saveNamedProfile/);
	assert.match(popupScript, /removeNamedProfile/);
	assert.doesNotMatch(popupScript, /createObjectURL|profileFileInput/);
	assert.match(popupScript, /eqBass/);
	assert.match(popupScript, /eqTreble/);
	assert.match(popupScript, /addSiteException/);
	assert.match(popupScript, /openOptionsPage/);
});

test('the footer overflow menu is hidden only while the no-media state is visible', () => {
	assert.match(popupScript, /moreMenuWrap\.hidden = noMediaStateVisible/);
	assert.match(popupScript, /if \(noMediaStateVisible\) setMoreMenuOpen\(false\)/);
});

test('profiles replace the right-aligned site menu without widening the popup', () => {
	assert.match(popupMarkup, /class="menu-profiles"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
	assert.match(popupMarkup, /class="menu-disable-site"[^>]*>Disable on this site<\/button>/);
	assert.match(popupMarkup, /class="menu-copy-diagnostics"[^>]*>Copy diagnostics<\/button>/);
	assert.match(popupMarkup, /class="menu-manage-exceptions"[^>]*>Settings and exceptions<\/button>/);
	assert.match(popupMarkup, /class="profile-flyout"[^>]*hidden>/);
	assert.match(popupStyles, /\.more-menu\s*\{[^}]*right:\s*0;[^}]*width:\s*190px;/s);
	assert.match(popupStyles, /\.profile-flyout\s*\{[^}]*position:\s*static;[^}]*max-height:\s*258px;[^}]*width:\s*100%;[^}]*overflow:\s*hidden;/s);
	assert.doesNotMatch(popupStyles, /profile-flyout-open/);
	assert.match(popupStyles, /\.profile-list-shell\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex:\s*0 1 auto;[^}]*flex-direction:\s*column;/s);
	assert.match(popupStyles, /\.profile-list\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*96px;[^}]*flex:\s*0 1 auto;[^}]*overflow-y:\s*auto;/s);
	assert.match(popupScript, /function setProfileFlyoutOpen\(open, restoreFocus = false\)/);
	assert.match(popupScript, /menuMain\.hidden = isOpen/);
	assert.match(popupScript, /backToMainMenuButton\.addEventListener\('click'/);
	assert.match(popupScript, /profileList\.scrollTop = 0;/);
});

test('save profile stays inside the flyout and footer feedback stays out of layout flow', () => {
	assert.match(popupMarkup, /class="profile-flyout"[\s\S]*<form class="profile-name-form" hidden>[\s\S]*<\/form>\s*<\/div>/);
	assert.match(popupStyles, /\.profile-flyout\.profile-form-open\s*\{[^}]*height:\s*174px;/s);
	assert.match(popupStyles, /\.profile-name-form\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*1px;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
	assert.match(popupStyles, /\.site-footer\s*\{[^}]*position:\s*relative;/s);
	assert.match(popupStyles, /\.site-profile-status\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 8px\);/s);
	assert.match(popupScript, /profileFormStatus\.textContent = 'Enter a profile name'/);
});

test('the profile view reserves space for several rows and exposes hidden profiles clearly', () => {
	assert.match(popupMarkup, /class="profile-list-shell">\s*<div class="profile-list"[^>]*><\/div>\s*<span class="profile-scroll-hint" hidden>Scroll for more<\/span>/);
	assert.match(popupScript, /profileList\.scrollHeight > profileList\.clientHeight \+ 1/);
	assert.match(popupScript, /profileScrollHint\.hidden = !hasMoreBelow/);
	assert.match(popupScript, /profilesMenuButton\.addEventListener\('click'/);
	assert.match(popupScript, /event\.key !== 'ArrowRight'/);
	assert.match(popupScript, /event\.key !== 'ArrowLeft'/);
});

test('Default is outside the scrolling profile list and Gain has no multiplier suffix', () => {
	assert.match(popupMarkup, /class="profile-default"[^>]*><\/div>\s*<div class="profile-list-shell">\s*<div class="profile-list"/);
	assert.match(popupScript, /const profileDefault = document\.querySelector\('\.profile-default'\)/);
	assert.match(popupScript, /\(profile\.builtIn \? profileDefault : profileList\)\.appendChild\(item\)/);
	assert.doesNotMatch(popupStyles, /\.profile-item:first-child\s*\{[^}]*position:\s*sticky/s);
	assert.doesNotMatch(popupMarkup, /gain-number-wrap|gain-unit|>×</u);
	assert.doesNotMatch(popupStyles, /gain-number-wrap|gain-unit/);
});

test('equalizer labels match the frequencies used by the Web Audio graph', () => {
	for (const label of ['250 Hz', '500 Hz', '2 kHz', '6 kHz', '8 kHz']) {
		assert.match(popupMarkup, new RegExp(`>${label.replace(' ', '\\s')}<`));
	}
	for (const frequency of [250, 500, 2000, 6000, 8000]) {
		assert.match(contentScript, new RegExp(`frequency\\.value = ${frequency};`));
	}
});

test('gain controls stay precise without redundant status copy or native spinners', () => {
	assert.doesNotMatch(popupMarkup, /gain-feedback|Original level|Reduced|Boosted/);
	assert.doesNotMatch(popupScript, /gainFeedback|Original level|Reduced|Boosted/);
	assert.match(popupStyles, /-moz-appearance:\s*textfield/);
	assert.match(popupStyles, /::-webkit-inner-spin-button/);
});

test('fixed hover zones provide wheel control for gain, pan, and every equalizer band', () => {
	assert.match(popupMarkup, /class="gain-control"/);
	assert.match(popupMarkup, /class="pan-control"/);
	assert.match(popupScript, /bindWheelAdjustment\(node\.querySelector\('\.gain-control'\), 'gain'/);
	assert.match(popupScript, /bindWheelAdjustment\(node\.querySelector\('\.pan-control'\), 'pan'/);
	assert.match(popupScript, /bindWheelAdjustment\(element\.closest\('\.eq-band'\), band/);
	assert.match(popupStateScript, /stepSettingValue\(setting, currentValue, direction, readSettings\(\)\)/);
	assert.doesNotMatch(popupScript, /gain\.addEventListener\('wheel'/);
});

test('5x gain, compact switches, and level feedback stay explicit without a limiter', () => {
	assert.doesNotMatch(popupMarkup, /element-extra-boost|10×|Extra boost/);
	assert.doesNotMatch(optionsMarkup, /default-extra-boost|10×|Extra boost/);
	assert.doesNotMatch(popupScript, /extraBoost|BOOST_WARNING_DURATION_MS|boostWarning/);
	assert.doesNotMatch(popupMarkup, /element-limiter|>Limiter</);
	assert.doesNotMatch(optionsMarkup, /default-limiter|Peak limiter/);
	assert.doesNotMatch(popupScript, /element-limiter|limiterEnabled|Peak limiter active/);
	assert.match(popupMarkup, /class="gain-value"[\s\S]*class="element-gain-num"[\s\S]*class="level-indicator"/);
	assert.match(popupStyles, /--level-ok:\s*#[0-9a-f]+;/i);
	assert.match(popupStyles, /\.level-indicator\s*\{[^}]*background:\s*var\(--level-ok\);/s);
	assert.doesNotMatch(popupMarkup, /class="level-(?:monitor|track|fill|status)"|class="gain-stack"/);
	assert.doesNotMatch(popupMarkup, /class="boost-tools"/);
	assert.doesNotMatch(popupMarkup, />All media</);
	assert.match(popupMarkup, /class="pan-control"[\s\S]*class="control-actions"[\s\S]*class="checkboxes"[\s\S]*class="element-mono"[\s\S]*class="element-flip"[\s\S]*class="element-reset"[\s\S]*class="equalizer-section\b/);
	assert.doesNotMatch(popupMarkup, /class="equalizer-section\b[\s\S]*class="checkboxes"/);
	assert.match(popupStyles, /\.control-actions\s*\{[^}]*justify-content:\s*space-between;[^}]*margin:\s*-2px 0 12px;/s);
	assert.match(popupMarkup, /class="element-mono"[\s\S]*class="switch-control"[\s\S]*>Mono</);
	assert.match(popupStyles, /input\[type="checkbox"\]:checked \+ \.switch-control::after\s*\{[^}]*transform:\s*translateX\(12px\);/s);
	assert.match(popupStyles, /\.level-indicator\[data-state="clipping"\]\s*\{[^}]*background:\s*var\(--danger\);/s);
	assert.match(popupStyles, /\.element-reset\s*\{[^}]*background:\s*var\(--danger-soft\);[^}]*color:\s*var\(--danger\);/s);
	assert.match(popupStateScript, /gain:\s*\[0, 5\]/);
	assert.match(popupScript, /action: 'getAudioLevel'/);
	assert.doesNotMatch(contentScript, /createDynamicsCompressor\(\)|xSoundFixerLimiter|setLimiterMode/);
	assert.match(contentScript, /createAnalyser\(\)/);
});

test('the icon-only support heart stays beside the title and only glows on interaction', () => {
	assert.match(popupMarkup, /<h1>Sound Adjuster<\/h1>[\s\S]*class="support-button"[^>]*href="https:\/\/buymeacoffee\.com\/tropicaddons"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="Support Sound Adjuster"[\s\S]*<svg[^>]*>[\s\S]*<path/);
	assert.doesNotMatch(popupMarkup, />\s*Buy me a coffee\s*</);
	assert.match(popupStyles, /\.support-button,\s*\.github-button\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*transparent;[^}]*color:\s*var\(--muted\);/s);
	assert.match(popupStyles, /\.support-button svg\s*\{[^}]*fill:\s*transparent;[^}]*stroke:\s*currentColor;/s);
	assert.match(popupStyles, /\.support-button:hover,[\s\S]*box-shadow:\s*0 0 0 2px var\(--support-soft\), 0 0 12px var\(--support-glow\);/s);
	assert.match(popupStyles, /\.support-button:hover svg,[\s\S]*fill:\s*var\(--support\);/s);
});

test('the GitHub icon links to the verified source repository beside the support heart', () => {
	assert.match(popupMarkup, /class="support-button"[\s\S]*class="github-button"[^>]*href="https:\/\/github\.com\/tropicaddons\/sound-adjuster"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="View Sound Adjuster on GitHub"[\s\S]*<svg[^>]*>[\s\S]*<path/);
	assert.match(popupStyles, /\.github-button\s*\{[^}]*margin-left:\s*4px;/s);
	assert.match(popupStyles, /\.github-button svg\s*\{[^}]*fill:\s*currentColor;/s);
	assert.match(popupStyles, /\.github-button:hover,[\s\S]*background:\s*var\(--surface-raised\);[\s\S]*color:\s*var\(--text\);/s);
});

test('global defaults, shortcuts, and toolbar badges are wired through extension surfaces', () => {
	assert.match(optionsMarkup, /Default audio settings/);
	assert.match(optionsMarkup, /class="edit-shortcuts"/);
	assert.match(optionsScript, /saveGlobalSettings/);
	assert.match(optionsScript, /openShortcutSettings/);
	assert.deepEqual(Object.keys(manifest.commands).sort(), [
		'decrease-gain',
		'increase-gain',
		'reset-audio',
		'toggle-mono'
	]);
	assert.equal(manifest.commands['increase-gain'].suggested_key.default, 'Alt+Up');
	assert.equal(manifest.commands['decrease-gain'].suggested_key.default, 'Alt+Down');
	assert.equal(manifest.background.scripts.includes('global-settings.js'), true);
	assert.match(backgroundScript, /browser\.commands\.onCommand/);
	assert.match(backgroundScript, /browser\.action\.setBadgeText/);
	assert.match(backgroundScript, /action: 'shortcutApplied'/);
	assert.match(popupScript, /message\?\.action === 'shortcutApplied'/);
	assert.match(popupScript, /syncControlsFromShortcut\(message\.settings\)/);
});

test('settings follows the theme chosen in the popup', () => {
	assert.match(optionsScript, /localStorage\?\.getItem\('soundAdjusterTheme'\)/);
	assert.match(optionsScript, /document\.documentElement\.classList\.toggle\('light-theme'/);
	assert.match(optionsScript, /addEventListener\('storage'/);
	assert.match(optionsStyles, /\.light-theme\s*\{/);
	assert.doesNotMatch(optionsStyles, /prefers-color-scheme/);
});

test('popup runtime logging contains no decorative emoji', () => {
	assert.doesNotMatch(popupScript, /🎚|🔍|📋|✅|❌|🎉|🎛|🎯/u);
});

test('popup remains usable when DOM storage is disabled', () => {
	assert.match(popupScript, /function getPopupStorage\(\)\s*\{[\s\S]*globalThis\.localStorage \|\| null;[\s\S]*catch/s);
	assert.match(popupScript, /const savedTheme = readPopupPreference\('soundAdjusterTheme'\) \|\| 'dark';/);
	assert.match(popupScript, /savePopupPreference\('soundAdjusterTheme', isLightTheme \? 'light' : 'dark'\);/);
	assert.match(popupScript, /restoreEqualizerExpanded\(node, getPopupStorage\(\)\);/);
	assert.match(popupScript, /setEqualizerExpanded\([\s\S]*getPopupStorage\(\)[\s\S]*\);/);
	assert.doesNotMatch(popupScript, /localStorage\.(?:getItem|setItem)/);
});
