'use strict';

const popupScrollport = document.getElementById('popup-scrollport');
const popupContent = document.getElementById('popup-content');
let popupLayoutFrame = 0;

function updatePopupHeightLimit() {
	popupLayoutFrame = 0;
	// Firefox can clip the native panel without reducing window.innerHeight.
	// These screen coordinates share CSS-pixel units, including display scaling.
	const popupTop = window.mozInnerScreenY;
	const screenBottom = window.screen.availTop + window.screen.availHeight;
	const browserBottom = window.screenY + window.outerHeight;
	if (!Number.isFinite(popupTop) || !Number.isFinite(screenBottom)
		|| !Number.isFinite(browserBottom)) return;
	// Only a small border/rounding inset is needed; browser chrome is measured.
	const availableHeight = Math.min(screenBottom, browserBottom) - popupTop - 8;
	const value = `${Math.max(0, Math.floor(Math.min(600, availableHeight)))}px`;
	if (document.documentElement.style.getPropertyValue('--popup-max-height') !== value) {
		document.documentElement.style.setProperty('--popup-max-height', value);
	}
}

function schedulePopupLayout() {
	if (!popupLayoutFrame) popupLayoutFrame = requestAnimationFrame(updatePopupHeightLimit);
}

updatePopupHeightLimit();
window.addEventListener('resize', schedulePopupLayout);
const popupContentObserver = new ResizeObserver(schedulePopupLayout);
popupContentObserver.observe(popupContent);
// Moving/resizing the host window need not resize the popup's content viewport.
const popupGeometryTimer = setInterval(schedulePopupLayout, 150);
window.addEventListener('unload', () => {
	clearInterval(popupGeometryTimer);
	cancelAnimationFrame(popupLayoutFrame);
	popupContentObserver.disconnect();
});

// In a short popup, wheel gestures over the audio controls must still scroll.
popupScrollport.addEventListener('wheel', event => {
	if (popupScrollport.scrollHeight <= popupScrollport.clientHeight + 1
		|| !event.target.closest('.gain-control, .pan-control, .eq-band')
		|| event.ctrlKey || event.deltaY === 0) return;
	event.preventDefault();
	event.stopPropagation();
	const unit = event.deltaMode === 1 ? 16
		: event.deltaMode === 2 ? popupScrollport.clientHeight : 1;
	popupScrollport.scrollTop += event.deltaY * unit;
}, { capture: true, passive: false });

let tid = 0;
let activeTab = null;
let siteProfileStatus = { eligible: false, remembered: false, profile: null };
let siteExceptionStatus = { eligible: false, siteKey: null, disabled: false };
let namedProfilesStatus = { eligible: false, siteKey: null, profiles: [] };
const frameMap = new Map();
let referenceMediaKey = null;
let currentControlsNode = null;
const allElements = document.getElementById('all-elements');
const elementsTpl = document.getElementById('elements-tpl');
const themeToggle = document.getElementById('theme-toggle');
const siteFooter = document.querySelector('.site-footer');
const siteHostname = document.querySelector('.site-hostname');
const siteProfileToggle = document.querySelector('.site-profile-toggle');
const rememberSite = document.querySelector('.remember-site');
const profileStatusText = document.querySelector('.site-profile-status');
const moreMenuWrap = document.querySelector('.more-menu-wrap');
const moreMenuButton = document.querySelector('.more-menu-button');
const moreMenu = document.querySelector('.more-menu');
const menuMain = document.querySelector('.menu-main');
const disableSiteButton = document.querySelector('.menu-disable-site');
const profileDefault = document.querySelector('.profile-default');
const profileList = document.querySelector('.profile-list');
const profileScrollHint = document.querySelector('.profile-scroll-hint');
const activeProfileName = document.querySelector('.active-profile-name');
const newProfileButton = document.querySelector('.menu-new-profile');
const profilesMenuButton = document.querySelector('.menu-profiles');
const profileFlyout = document.querySelector('.profile-flyout');
const backToMainMenuButton = document.querySelector('.menu-back-main');
const profileNameForm = document.querySelector('.profile-name-form');
const profileNameInput = document.querySelector('.profile-name-input');
const profileFormStatus = document.querySelector('.profile-form-status');
const profileSaveButton = document.querySelector('.profile-save-button');
const profileCancelButton = document.querySelector('.profile-cancel-button');
const manageProfilesButton = document.querySelector('.menu-manage-profiles');
const copyDiagnosticsButton = document.querySelector('.menu-copy-diagnostics');
const manageExceptionsButton = document.querySelector('.menu-manage-exceptions');
let noMediaStateVisible = false;
let autoMediaScanTimer = null;
let autoMediaScanInFlight = false;
let profileOperationQueue = Promise.resolve();
let profileFeedbackSequence = 0;
let footerFeedbackTimer = null;
let profileManageMode = false;
const AUTO_MEDIA_SCAN_INTERVAL_MS = 700;
const MAX_NAMED_PROFILES_PER_SITE = 12;

// Equalizer Presets
const equalizerPresets = {
	flat: { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
	rock: { bass: 4, lowMid: 2, mid: -1, highMid: 2, treble: 3 },
	pop: { bass: 2, lowMid: 1, mid: 3, highMid: 2, treble: 1 },
	classical: { bass: 3, lowMid: 2, mid: -1, highMid: -2, treble: 2 },
	jazz: { bass: 3, lowMid: 1, mid: -1, highMid: 1, treble: 2 },
	bassBoost: { bass: 6, lowMid: 3, mid: -2, highMid: -1, treble: 0 },
	vocal: { bass: -2, lowMid: 3, mid: 5, highMid: 3, treble: -1 },
	dance: { bass: 5, lowMid: 2, mid: 1, highMid: 4, treble: 4 }
};

const {
	DEFAULT_SETTINGS: POPUP_DEFAULT_SETTINGS,
	applySettingsToControls,
	bindWheelAdjustment,
	normalizeSettings,
	readSettingsFromControls,
	restoreEqualizerExpanded,
	setEqualizerExpanded,
	updatePresetButtons
} = globalThis.SoundAdjusterPopupState;

function sendProfileMessage(action, settings) {
	return browser.runtime.sendMessage({
		action,
		tabUrl: activeTab?.url,
		incognito: activeTab?.incognito === true,
		settings
	});
}

function sendContextMessage(action, details = {}) {
	return browser.runtime.sendMessage({
		action,
		tabUrl: activeTab?.url,
		incognito: activeTab?.incognito === true,
		...details
	});
}

async function loadSiteProfileStatus() {
	try {
		return await sendProfileMessage('getSiteProfile');
	} catch (error) {
		console.warn('Unable to read the site profile:', error);
		return { eligible: false, remembered: false, profile: null };
	}
}

async function loadSiteExceptionStatus() {
	try {
		return await sendContextMessage('getSiteExceptionStatus');
	} catch (error) {
		console.warn('Unable to read the site exception status:', error);
		return { eligible: false, siteKey: null, disabled: false };
	}
}

async function loadNamedProfilesStatus() {
	try {
		return await sendContextMessage('getNamedProfiles');
	} catch (error) {
		console.warn('Unable to read named profiles:', error);
		return { eligible: false, siteKey: null, profiles: [] };
	}
}

// Theme Management
function initializeTheme() {
	const savedTheme = localStorage.getItem('soundAdjusterTheme') || 'dark';
	document.body.classList.toggle('light-theme', savedTheme === 'light');
	updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
	const isLightTheme = document.body.classList.contains('light-theme');
	themeToggle.textContent = isLightTheme ? '☾' : '☼';
	themeToggle.title = isLightTheme ? 'Switch to Dark Mode' : 'Switch to Light Mode';
	themeToggle.setAttribute('aria-label', themeToggle.title);
}

function toggleTheme() {
	document.body.classList.toggle('light-theme');
	const isLightTheme = document.body.classList.contains('light-theme');
	localStorage.setItem('soundAdjusterTheme', isLightTheme ? 'light' : 'dark');
	updateThemeToggleIcon();
}

// Initialize theme on load
initializeTheme();
themeToggle.addEventListener('click', toggleTheme);

function getActiveSiteKey() {
	const knownSiteKey = siteProfileStatus?.siteKey || siteExceptionStatus?.siteKey || namedProfilesStatus?.siteKey;
	if (knownSiteKey) return knownSiteKey;
	try {
		const url = new URL(activeTab?.url);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		let hostname = url.hostname.toLowerCase();
		if (hostname.startsWith('www.')) hostname = hostname.slice(4);
		return url.port ? `${hostname}:${url.port}` : hostname;
	} catch (error) {
		return null;
	}
}

function setFooterFeedback(text, state = 'idle', timeout = 0) {
	clearTimeout(footerFeedbackTimer);
	footerFeedbackTimer = null;
	if (!profileStatusText) return;
	profileStatusText.textContent = text;
	profileStatusText.dataset.state = state;
	if (text && timeout > 0) {
		footerFeedbackTimer = setTimeout(() => {
			profileStatusText.textContent = '';
			profileStatusText.dataset.state = 'idle';
		}, timeout);
	}
}

function showCurrentProfileStatus() {
	setFooterFeedback('');
}

function queueProfileOperation(operation) {
	profileOperationQueue = profileOperationQueue
		.catch(() => undefined)
		.then(operation);
	return profileOperationQueue;
}

function settingsMatch(first, second) {
	const firstSettings = normalizeSettings(first);
	const secondSettings = normalizeSettings(second);
	return Object.keys(POPUP_DEFAULT_SETTINGS).every(key => {
		if (typeof POPUP_DEFAULT_SETTINGS[key] === 'boolean') {
			return firstSettings[key] === secondSettings[key];
		}
		return Math.abs(firstSettings[key] - secondSettings[key]) < 0.0001;
	});
}

function getActiveNamedProfile() {
	if (!currentControlsNode) return null;
	const settings = readSettingsFromControls(currentControlsNode);
	if (settingsMatch(settings, POPUP_DEFAULT_SETTINGS)) {
		return { id: 'default', name: 'Default', settings: POPUP_DEFAULT_SETTINGS, builtIn: true };
	}
	return namedProfilesStatus.profiles?.find(profile => settingsMatch(settings, profile.settings)) || null;
}

function hideProfileNameForm() {
	profileNameForm.hidden = true;
	profileFlyout.classList.remove('profile-form-open');
	newProfileButton.hidden = false;
	profileNameInput.value = '';
	profileFormStatus.textContent = '';
}

function showProfileNameForm() {
	setFooterFeedback('');
	profileFormStatus.textContent = '';
	newProfileButton.hidden = true;
	profileNameForm.hidden = false;
	profileFlyout.classList.add('profile-form-open');
	moreMenu.scrollTop = 0;
	profileNameInput.focus();
}

function updateProfileScrollHint() {
	if (!profileScrollHint || !profileList) return;
	const hasMoreBelow = profileList.scrollHeight > profileList.clientHeight + 1
		&& profileList.scrollTop + profileList.clientHeight < profileList.scrollHeight - 1;
	profileScrollHint.hidden = !hasMoreBelow;
}

function scheduleProfileScrollHintUpdate() {
	requestAnimationFrame(updateProfileScrollHint);
}

function setProfileFlyoutOpen(open, restoreFocus = false) {
	const isOpen = open === true;
	if (isOpen) {
		profileManageMode = false;
		hideProfileNameForm();
		renderNamedProfiles();
		profileList.scrollTop = 0;
		scheduleProfileScrollHintUpdate();
	}
	profileFlyout.hidden = !isOpen;
	menuMain.hidden = isOpen;
	moreMenu.scrollTop = 0;
	profilesMenuButton.setAttribute('aria-expanded', String(isOpen));
	if (!isOpen) hideProfileNameForm();
	if (!isOpen && restoreFocus) profilesMenuButton.focus();
}

function renderNamedProfiles() {
	if (!profileDefault || !profileList) return;
	profileDefault.replaceChildren();
	profileList.replaceChildren();
	const activeProfile = getActiveNamedProfile();
	activeProfileName.textContent = activeProfile?.name || 'Custom';

	const profiles = [
		{ id: 'default', name: 'Default', settings: POPUP_DEFAULT_SETTINGS, builtIn: true },
		...(namedProfilesStatus.profiles || [])
	];

	for (const profile of profiles) {
		const item = document.createElement('div');
		item.className = 'profile-item';

		const selectButton = document.createElement('button');
		selectButton.type = 'button';
		selectButton.className = 'profile-select-button';
		selectButton.setAttribute('role', 'menuitemradio');
		selectButton.disabled = !currentControlsNode || siteExceptionStatus?.disabled === true;
		const isActive = activeProfile?.id === profile.id;
		selectButton.setAttribute('aria-checked', String(isActive));
		selectButton.classList.toggle('active', isActive);

		const check = document.createElement('span');
		check.className = 'profile-check';
		check.textContent = isActive ? '✓' : '';
		const name = document.createElement('span');
		name.className = 'profile-item-name';
		name.textContent = profile.name;
		selectButton.append(check, name);
		selectButton.addEventListener('click', () => applyNamedProfile(profile));
		item.appendChild(selectButton);

		if (!profile.builtIn) {
			const removeButton = document.createElement('button');
			removeButton.type = 'button';
			removeButton.className = 'profile-delete-button';
			removeButton.textContent = '×';
			removeButton.title = `Remove ${profile.name}`;
			removeButton.setAttribute('aria-label', removeButton.title);
			removeButton.hidden = !profileManageMode;
			removeButton.addEventListener('click', () => removeNamedProfileFromSite(profile));
			item.appendChild(removeButton);
		}

		(profile.builtIn ? profileDefault : profileList).appendChild(item);
	}

	manageProfilesButton.textContent = profileManageMode ? 'Done' : 'Manage profiles';
	manageProfilesButton.disabled = namedProfilesStatus.eligible !== true
		|| (namedProfilesStatus.profiles || []).length === 0;
	scheduleProfileScrollHintUpdate();
}

async function applyNamedProfile(profile) {
	if (!currentControlsNode || siteExceptionStatus?.disabled === true) return;
	try {
		const restored = applySettingsToControls(currentControlsNode, profile.settings, equalizerPresets);
		await applySettingsToAllMedia(restored.settings);
		await persistCurrentProfile();
		renderNamedProfiles();
		setMoreMenuOpen(false);
		setFooterFeedback(`${profile.name} applied`, 'info', 1800);
	} catch (error) {
		console.warn('Unable to apply the selected profile:', error);
		setFooterFeedback('Couldn’t apply profile', 'error');
	}
}

async function removeNamedProfileFromSite(profile) {
	try {
		namedProfilesStatus = await sendContextMessage('removeNamedProfile', { profileId: profile.id });
		profileManageMode = (namedProfilesStatus.profiles || []).length > 0;
		renderNamedProfiles();
		updateSiteFooter();
		setFooterFeedback('');
	} catch (error) {
		console.warn('Unable to remove the selected profile:', error);
		setFooterFeedback('Couldn’t remove profile', 'error');
	}
}

async function saveCurrentNamedProfile(name) {
	if (!currentControlsNode) return;
	profileSaveButton.disabled = true;
	try {
		namedProfilesStatus = await sendContextMessage('saveNamedProfile', {
			name,
			settings: readSettingsFromControls(currentControlsNode)
		});
		hideProfileNameForm();
		renderNamedProfiles();
		updateSiteFooter();
		setFooterFeedback('');
	} catch (error) {
		console.warn('Unable to save the named profile:', error);
		profileFormStatus.textContent = /profile name is required/i.test(error?.message || '')
			? 'Enter a profile name'
			: 'Couldn’t save profile';
	} finally {
		profileSaveButton.disabled = false;
	}
}

function updateSiteFooter() {
	const siteKey = getActiveSiteKey();
	if (!siteFooter) return;
	siteFooter.hidden = !siteKey;
	if (!siteKey) return;

	siteHostname.textContent = siteKey;
	siteHostname.title = siteKey;
	moreMenuWrap.hidden = noMediaStateVisible;
	if (noMediaStateVisible) setMoreMenuOpen(false);

	const profileEligible = siteProfileStatus?.eligible === true;
	const hasEditableControls = Boolean(currentControlsNode) && siteExceptionStatus?.disabled !== true;
	siteProfileToggle.hidden = !profileEligible || (!hasEditableControls && siteProfileStatus?.remembered !== true);
	rememberSite.checked = siteProfileStatus?.remembered === true;

	disableSiteButton.disabled = siteExceptionStatus?.eligible !== true;
	disableSiteButton.textContent = siteExceptionStatus?.disabled
		? 'Enable on this site'
		: 'Disable on this site';
	newProfileButton.disabled = !hasEditableControls || namedProfilesStatus?.eligible !== true;
	newProfileButton.disabled = newProfileButton.disabled
		|| (namedProfilesStatus.profiles || []).length >= MAX_NAMED_PROFILES_PER_SITE;
	newProfileButton.title = (namedProfilesStatus.profiles || []).length >= MAX_NAMED_PROFILES_PER_SITE
		? `Maximum ${MAX_NAMED_PROFILES_PER_SITE} profiles per site`
		: '';
	manageProfilesButton.disabled = namedProfilesStatus?.eligible !== true
		|| (namedProfilesStatus.profiles || []).length === 0;
	renderNamedProfiles();
}

function setMoreMenuOpen(open) {
	const isOpen = open === true;
	if (isOpen) {
		profileManageMode = false;
		renderNamedProfiles();
	}
	setProfileFlyoutOpen(false);
	moreMenu.hidden = !isOpen;
	moreMenuButton.setAttribute('aria-expanded', String(isOpen));
}

async function persistCurrentProfile() {
	if (!rememberSite?.checked || !currentControlsNode) return;
	const feedbackId = ++profileFeedbackSequence;
	try {
		const settings = readSettingsFromControls(currentControlsNode);
		siteProfileStatus = await queueProfileOperation(() => (
			sendProfileMessage('saveSiteProfile', settings)
		));
		if (feedbackId === profileFeedbackSequence) showCurrentProfileStatus();
	} catch (error) {
		console.warn('Unable to save the site profile:', error);
		if (feedbackId === profileFeedbackSequence) {
			setFooterFeedback('Couldn’t save settings', 'error');
		}
	}
	updateSiteFooter();
}

function applySettingsToAllMedia(settings) {
	const operations = [];
	for (const [fid, elements] of frameMap) {
		for (const [elid] of elements) {
			operations.push(applySettings(fid, elid, settings));
		}
	}
	return Promise.all(operations);
}

function buildDiagnosticsText() {
	const capabilities = new Map();
	const reasons = new Map();
	let mediaCount = 0;
	for (const mediaMap of frameMap.values()) {
		for (const media of mediaMap.values()) {
			mediaCount += 1;
			const mode = media?.capability?.mode || 'unknown';
			const reason = media?.capability?.reason || 'none';
			capabilities.set(mode, (capabilities.get(mode) || 0) + 1);
			reasons.set(reason, (reasons.get(reason) || 0) + 1);
		}
	}

	const formatCounts = counts => [...counts.entries()]
		.map(([name, count]) => `${name}=${count}`)
		.join(', ') || 'none';
	const settings = currentControlsNode
		? readSettingsFromControls(currentControlsNode)
		: null;
	const activeNamedProfile = getActiveNamedProfile();

	return [
		'Sound Adjuster diagnostics',
		`Version: ${browser.runtime.getManifest().version}`,
		`Site: ${getActiveSiteKey() || 'unavailable'}`,
		`Site disabled: ${siteExceptionStatus?.disabled === true ? 'yes' : 'no'}`,
		`Remembered profile: ${siteProfileStatus?.remembered === true ? 'yes' : 'no'}`,
		`Named profiles: ${(namedProfilesStatus.profiles || []).length}`,
		`Active named profile: ${activeNamedProfile?.name || 'Custom'}`,
		`Frames scanned: ${frameMap.size}`,
		`Media elements: ${mediaCount}`,
		`Capabilities: ${formatCounts(capabilities)}`,
		`Reasons: ${formatCounts(reasons)}`,
		`Settings: ${settings ? JSON.stringify(settings) : 'unavailable'}`,
		`Browser: ${navigator.userAgent}`,
		`Generated: ${new Date().toISOString()}`
	].join('\n');
}

async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch (error) {
			// Fall back to the temporary textarea below.
		}
	}
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.select();
	const copied = document.execCommand('copy');
	textarea.remove();
	if (!copied) throw new Error('Clipboard copy was rejected');
}

async function notifyFramesSiteDisabled(disabled) {
	const frames = await browser.webNavigation.getAllFrames({ tabId: tid });
	await Promise.all(frames.map(frame => (
		browser.tabs.sendMessage(tid, {
			action: 'setSiteDisabled',
			disabled
		}, { frameId: frame.frameId }).catch(() => undefined)
	)));
}

async function toggleSiteException() {
	if (siteExceptionStatus?.eligible !== true) return;
	disableSiteButton.disabled = true;
	const shouldDisable = siteExceptionStatus.disabled !== true;
	try {
		siteExceptionStatus = await sendContextMessage(
			shouldDisable ? 'addSiteException' : 'removeSiteException'
		);
		await notifyFramesSiteDisabled(shouldDisable);
		const frameResults = await scanMedia();
		renderFrameResults(frameResults);
		setFooterFeedback(
			shouldDisable ? 'Disabled for this site' : 'Enabled for this site',
			'info',
			1800
		);
	} catch (error) {
		console.warn('Unable to update the site exception:', error);
		setFooterFeedback('Couldn’t update site access', 'error');
	} finally {
		updateSiteFooter();
	}
}

function initializeSiteFooterActions() {
	moreMenuButton.addEventListener('click', event => {
		event.stopPropagation();
		setMoreMenuOpen(moreMenu.hidden);
	});
	moreMenu.addEventListener('click', event => event.stopPropagation());
	document.addEventListener('click', () => setMoreMenuOpen(false));
	document.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		if (!profileNameForm.hidden) {
			hideProfileNameForm();
			return;
		}
		if (!profileFlyout.hidden) {
			setProfileFlyoutOpen(false, true);
			return;
		}
		setMoreMenuOpen(false);
	});

	rememberSite.addEventListener('change', async () => {
		const shouldRemember = rememberSite.checked;
		const feedbackId = ++profileFeedbackSequence;
		rememberSite.disabled = true;
		setFooterFeedback('');
		try {
			siteProfileStatus = await queueProfileOperation(() => (
				shouldRemember
					? sendProfileMessage('saveSiteProfile', readSettingsFromControls(currentControlsNode))
					: sendProfileMessage('removeSiteProfile')
			));
			rememberSite.checked = siteProfileStatus.remembered === true;
			if (feedbackId === profileFeedbackSequence) showCurrentProfileStatus();
		} catch (error) {
			console.warn('Unable to update the site profile:', error);
			rememberSite.checked = !shouldRemember;
			if (feedbackId === profileFeedbackSequence) {
				setFooterFeedback('Couldn’t update profile', 'error');
			}
		} finally {
			rememberSite.disabled = false;
			updateSiteFooter();
		}
	});

	disableSiteButton.addEventListener('click', async () => {
		setMoreMenuOpen(false);
		await toggleSiteException();
	});
	newProfileButton.addEventListener('click', showProfileNameForm);
	profilesMenuButton.addEventListener('click', () => {
		setProfileFlyoutOpen(profileFlyout.hidden);
	});
	backToMainMenuButton.addEventListener('click', () => {
		setProfileFlyoutOpen(false, true);
	});
	profilesMenuButton.addEventListener('keydown', event => {
		if (event.key !== 'ArrowRight') return;
		event.preventDefault();
		setProfileFlyoutOpen(true);
		profileFlyout.querySelector('button:not(:disabled)')?.focus();
	});
	profileFlyout.addEventListener('keydown', event => {
		if (event.key !== 'ArrowLeft' || event.target === profileNameInput) return;
		event.preventDefault();
		setProfileFlyoutOpen(false, true);
	});
	profileList.addEventListener('scroll', updateProfileScrollHint);
	profileCancelButton.addEventListener('click', hideProfileNameForm);
	profileNameInput.addEventListener('input', () => {
		profileFormStatus.textContent = '';
	});
	profileNameForm.addEventListener('submit', event => {
		event.preventDefault();
		const name = profileNameInput.value.trim();
		if (!name) {
			profileNameInput.focus();
			profileFormStatus.textContent = 'Enter a profile name';
			return;
		}
		saveCurrentNamedProfile(name);
	});
	manageProfilesButton.addEventListener('click', () => {
		profileManageMode = !profileManageMode;
		hideProfileNameForm();
		renderNamedProfiles();
	});
	copyDiagnosticsButton.addEventListener('click', async () => {
		setMoreMenuOpen(false);
		try {
			await copyText(buildDiagnosticsText());
			setFooterFeedback('Diagnostics copied', 'info', 1800);
		} catch (error) {
			console.warn('Unable to copy diagnostics:', error);
			setFooterFeedback('Couldn’t copy diagnostics', 'error');
		}
	});
	manageExceptionsButton.addEventListener('click', () => {
		setMoreMenuOpen(false);
		browser.runtime.openOptionsPage();
	});
}

initializeSiteFooterActions();

function createEmptyState(titleText, descriptionText, includeReloadButton = true) {
	const emptyState = document.createElement('div');
	emptyState.className = 'empty-state';

	const title = document.createElement('h2');
	title.textContent = titleText;

	const description = document.createElement('p');
	description.textContent = descriptionText;

	const reloadButton = document.createElement('button');
	reloadButton.type = 'button';
	reloadButton.className = 'reload-button';
	reloadButton.textContent = '↻';
	reloadButton.title = 'Scan again';
	reloadButton.setAttribute('aria-label', 'Scan again');
	reloadButton.addEventListener('click', () => scanForNewMedia());

	emptyState.appendChild(title);
	emptyState.appendChild(description);
	if (includeReloadButton) emptyState.appendChild(reloadButton);
	return emptyState;

}

function showNoMediaState() {
	currentControlsNode = null;
	noMediaStateVisible = true;
	allElements.innerHTML = '';
	allElements.classList.add('is-empty');
	allElements.appendChild(createEmptyState(
		'No media available',
		'Start playing audio or video. It will appear here automatically.'
	));
	scheduleAutoMediaScan();
	updateSiteFooter();
}

function showUnavailableMediaState(capability) {
	const descriptions = {
		'site-restricted': 'This site prevents Sound Adjuster from safely accessing its audio. Playback continues normally.',
		'cross-origin-media': 'Firefox blocks the audio access needed for this media source. Playback continues normally.',
		'protected-media': 'This media uses protected playback, so Firefox does not allow extensions to adjust its audio. Playback continues normally.',
		'audio-graph-failed': 'Sound Adjuster could not create a safe audio connection. Playback continues normally.',
		'web-audio-unavailable': 'Firefox does not provide the audio access needed for this media. Playback continues normally.'
	};

	currentControlsNode = null;
	noMediaStateVisible = false;
	stopAutoMediaScan();
	allElements.innerHTML = '';
	allElements.classList.add('is-empty');
	allElements.appendChild(createEmptyState(
		'Audio controls unavailable',
		descriptions[capability?.reason] || 'Sound Adjuster cannot safely process this media. Playback continues normally.'
	));
	updateSiteFooter();
}

function showSiteDisabledState() {
	currentControlsNode = null;
	noMediaStateVisible = false;
	stopAutoMediaScan();
	allElements.innerHTML = '';
	allElements.classList.add('is-empty');
	allElements.appendChild(createEmptyState(
		'Sound Adjuster is off',
		'This site is in your exceptions. Re-enable it from the ⋯ menu when you want to use audio controls again.',
		false
	));
	updateSiteFooter();
}

function applySettings(fid, elid, newSettings) {
	return browser.tabs.sendMessage(tid, {
		action: "applySettings",
		elid: elid,
		settings: newSettings
	}, { frameId: fid }).then(result => {
		const capability = result?.capability;
		if (`${fid}:${elid}` === referenceMediaKey && capability) {
			if (capability.mode === 'disabled') showSiteDisabledState();
			if (capability.mode === 'basic' || capability.mode === 'unsupported') {
				showUnavailableMediaState(capability);
			}
		}
		return result;
	}).catch(err => {
		console.error(`Failed to apply settings to element ${elid}:`, err);
		throw err;
	});
}

function scanMedia() {
	return browser.webNavigation.getAllFrames({ tabId: tid }).then(frames => {
		return Promise.all(frames.map(frame =>
			browser.tabs.sendMessage(tid, { action: "scanMedia" }, { frameId: frame.frameId })
			.then(result => {
				return {
					frameId: frame.frameId,
					media: result ? result.media : {}
				};
			}).catch(err => {
				console.warn(`Unable to scan frame ${frame.frameId}:`, err.message);
				return { frameId: frame.frameId, media: {} };
			})
		));
	});
}

function countScannedMedia(frameResults) {
	return frameResults.reduce((count, frameResult) => (
		count + Object.keys(frameResult.media || {}).length
	), 0);
}

function stopAutoMediaScan() {
	clearTimeout(autoMediaScanTimer);
	autoMediaScanTimer = null;
}

function scheduleAutoMediaScan(delay = AUTO_MEDIA_SCAN_INTERVAL_MS) {
	if (!noMediaStateVisible || autoMediaScanTimer !== null) return;
	autoMediaScanTimer = setTimeout(() => {
		autoMediaScanTimer = null;
		scanForNewMedia();
	}, delay);
}

async function scanForNewMedia() {
	if (!noMediaStateVisible || autoMediaScanInFlight) return;
	autoMediaScanInFlight = true;

	try {
		const frameResults = await scanMedia();
		if (noMediaStateVisible && countScannedMedia(frameResults) > 0) {
			noMediaStateVisible = false;
			stopAutoMediaScan();
			renderFrameResults(frameResults);
		}
	} catch (error) {
		console.warn('Automatic media scan failed:', error);
	} finally {
		autoMediaScanInFlight = false;
		if (noMediaStateVisible) scheduleAutoMediaScan();
	}
}

function renderFrameResults(frameResults) {
		let elCount = 0;

		// Clear existing frame map
		frameMap.clear();

		// Process results from all frames - collect all media for global control
		for (const frameResult of frameResults) {
			const fid = frameResult.frameId;
			const mediaMap = new Map(Object.entries(frameResult.media || {}));
			frameMap.set(fid, mediaMap);
			elCount += mediaMap.size; // Count total elements
		}

		if (elCount == 0) {
			showNoMediaState();
		} else {
			noMediaStateVisible = false;
			stopAutoMediaScan();
			const scannedMedia = [];
			for (const [fid, mediaMap] of frameMap) {
				for (const [elid, media] of mediaMap) {
					scannedMedia.push({ fid, elid, media });
				}
			}

			const referenceEntry = scannedMedia.find(entry => entry.media.isPlaying) || scannedMedia[0];
			const referenceMedia = referenceEntry.media;
			referenceMediaKey = `${referenceEntry.fid}:${referenceEntry.elid}`;

			if (referenceMedia.capability?.mode === 'disabled') {
				showSiteDisabledState();
				return;
			}

			if (referenceMedia.capability?.mode === 'basic' || referenceMedia.capability?.mode === 'unsupported') {
				showUnavailableMediaState(referenceMedia.capability);
				return;
			}

			const node = document.createElement('div');
			node.appendChild(document.importNode(elementsTpl.content, true));

			// The popup is destroyed whenever it is closed. Restore every control
			// from the content script, where the active media settings remain alive.
			const restoredUiState = applySettingsToControls(
				node,
				referenceMedia?.settings,
				equalizerPresets
			);

			const gain = node.querySelector('.element-gain');
			const gainNumberInput = node.querySelector('.element-gain-num');
			gain.style.display = 'inline-block';
			gain.style.width = '100%';
			function applyGain (value, formatNumber = true) {
				value = Math.max(0, Math.min(5, Number.parseFloat(value) || 0));
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { gain: value });
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`);
						if (egain) {
							egain.value = value;
							egain.parentElement.querySelector('.element-gain-num').value = '' + value;
						}
					}
				}
				gain.value = value;
				if (formatNumber) gainNumberInput.value = value.toFixed(2);
				renderNamedProfiles();
			}
			gain.addEventListener('input', _ => applyGain(gain.value));
			bindWheelAdjustment(node.querySelector('.gain-control'), 'gain', () => gain.value, nextValue => {
				applyGain(nextValue);
				persistCurrentProfile();
			});
			gainNumberInput.addEventListener('input', function () {
				if (this.value === '') return;
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max');
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min');
				applyGain(this.value, false);
			});
			gainNumberInput.addEventListener('change', () => applyGain(gainNumberInput.value, true));

			const pan = node.querySelector('.element-pan');
			const panNumberInput = node.querySelector('.element-pan-num');
			pan.style.display = 'inline-block';
			pan.style.width = '100%';
			function applyPan (value) {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { pan: value });
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`);
						if (epan) {
							epan.value = value;
							epan.parentElement.querySelector('.element-pan-num').value = '' + value;
						}
					}
				}
				pan.value = value;
				panNumberInput.value = '' + value;
			}
			pan.addEventListener('input', _ => applyPan(pan.value));
			bindWheelAdjustment(node.querySelector('.pan-control'), 'pan', () => pan.value, nextValue => {
				applyPan(nextValue);
				renderNamedProfiles();
				persistCurrentProfile();
			});
			panNumberInput.addEventListener('input', function () {
				if (+this.value > +this.getAttribute('max'))
					this.value = this.getAttribute('max');
				if (+this.value < +this.getAttribute('min'))
					this.value = this.getAttribute('min');
				applyPan(+this.value);
			});

			const mono = node.querySelector('.element-mono');
			mono.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { mono: mono.checked });
						const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`);
						if (emono) emono.checked = mono.checked;
					}
				}
			});

			const flip = node.querySelector('.element-flip');
			flip.addEventListener('change', _ => {
				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						applySettings(fid, elid, { flip: flip.checked });
						const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`);
						if (eflip) eflip.checked = flip.checked;
					}
				}
			});

			// Equalizer controls for all elements
			const eqBass = node.querySelector('.element-eq-bass');
			const eqLowMid = node.querySelector('.element-eq-lowmid');
			const eqMid = node.querySelector('.element-eq-mid');
			const eqHighMid = node.querySelector('.element-eq-highmid');
			const eqTreble = node.querySelector('.element-eq-treble');

			function currentEqualizerSettings() {
				return {
					eqBass: Number.parseFloat(eqBass?.value),
					eqLowMid: Number.parseFloat(eqLowMid?.value),
					eqMid: Number.parseFloat(eqMid?.value),
					eqHighMid: Number.parseFloat(eqHighMid?.value),
					eqTreble: Number.parseFloat(eqTreble?.value)
				};
			}

			// Add global equalizer event listeners
			const setupGlobalEqControl = (element, band) => {
				if (!element) return;
				element.addEventListener('input', function () {
					const value = parseInt(this.value);
					const setting = {};
					setting[band] = value;

					// Apply to all elements
					for (const [fid, els] of frameMap) {
						for (const [elid, el] of els) {
							applySettings(fid, elid, setting);
							// Update individual controls
							const eElement = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-${band.replace('eq', 'eq-')}`);
							if (eElement) eElement.value = value;
						}
					}

					// Update value display
					const valueDisplay = this.parentElement.querySelector('.band-value');
					if (valueDisplay) {
						valueDisplay.textContent = value > 0 ? `+${value}dB` : `${value}dB`;
					}

					activePreset = updatePresetButtons(
						node,
						currentEqualizerSettings(),
						equalizerPresets
					);
				});
				bindWheelAdjustment(element.closest('.eq-band'), band, () => element.value, nextValue => {
					element.value = String(nextValue);
					element.dispatchEvent(new Event('input', { bubbles: true }));
					persistCurrentProfile();
				});
			};

			setupGlobalEqControl(eqBass, 'eqBass');
			setupGlobalEqControl(eqLowMid, 'eqLowMid');
			setupGlobalEqControl(eqMid, 'eqMid');
			setupGlobalEqControl(eqHighMid, 'eqHighMid');
			setupGlobalEqControl(eqTreble, 'eqTreble');

			// Equalizer toggle functionality
			const eqToggle = node.querySelector('.equalizer-toggle');
			const eqSection = node.querySelector('.equalizer-section');

			if (eqToggle && eqSection) {
				restoreEqualizerExpanded(node, localStorage);
				eqToggle.addEventListener('click', function () {
					const expanded = setEqualizerExpanded(
						node,
						eqSection.classList.contains('collapsed'),
						localStorage
					);
				});
			}

			// Equalizer preset functionality
			const presetButtons = node.querySelectorAll('.preset-btn');
			let activePreset = restoredUiState.presetName;

			presetButtons.forEach(button => {
				button.addEventListener('click', function () {
					const presetName = this.getAttribute('data-preset');
					const preset = equalizerPresets[presetName];

					if (!preset) return;

					// Update slider values
					if (eqBass) eqBass.value = preset.bass;
					if (eqLowMid) eqLowMid.value = preset.lowMid;
					if (eqMid) eqMid.value = preset.mid;
					if (eqHighMid) eqHighMid.value = preset.highMid;
					if (eqTreble) eqTreble.value = preset.treble;

					// Update value displays
					node.querySelectorAll('.band-value').forEach((display, index) => {
						const values = [preset.bass, preset.lowMid, preset.mid, preset.highMid, preset.treble];
						const value = values[index];
						display.textContent = value > 0 ? `+${value}dB` : `${value}dB`;
					});

					// Apply preset to all elements
					for (const [fid, els] of frameMap) {
						for (const [elid, el] of els) {
							applySettings(fid, elid, {
								eqBass: preset.bass,
								eqLowMid: preset.lowMid,
								eqMid: preset.mid,
								eqHighMid: preset.highMid,
								eqTreble: preset.treble
							});
						}
					}

					// Update active preset button
					presetButtons.forEach(btn => btn.classList.remove('active'));
					this.classList.add('active');
					activePreset = presetName;
					renderNamedProfiles();
					persistCurrentProfile();
  });
});

			node.querySelector('.element-reset').onclick = function () {
				const resetUiState = applySettingsToControls(
					node,
					POPUP_DEFAULT_SETTINGS,
					equalizerPresets
				);
				activePreset = resetUiState.presetName;

				for (const [fid, els] of frameMap) {
					for (const [elid, el] of els) {
						const egain = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-gain`);
						if (egain) {
							egain.value = 1;
							egain.parentElement.querySelector('.element-gain-num').value = '' + egain.value;
						}
						const epan = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-pan`);
						if (epan) {
							epan.value = 0;
							epan.parentElement.querySelector('.element-pan-num').value = '' + epan.value;
						}
						const emono = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-mono`);
						if (emono) emono.checked = false;
						const eflip = document.querySelector(`[data-fid="${fid}"][data-elid="${elid}"] .element-flip`);
						if (eflip) eflip.checked = false;
						applySettings(fid, elid, {
							gain: 1, pan: 0, mono: false, flip: false,
							eqBass: 0, eqLowMid: 0, eqMid: 0, eqHighMid: 0, eqTreble: 0
						});
					}
				}
				renderNamedProfiles();
				persistCurrentProfile();
			};

			node.querySelectorAll([
				'.element-gain', '.element-gain-num', '.element-pan', '.element-pan-num',
				'.element-mono', '.element-flip', '.element-eq-bass', '.element-eq-lowmid',
				'.element-eq-mid', '.element-eq-highmid', '.element-eq-treble'
			].join(',')).forEach(control => {
				control.addEventListener('input', () => renderNamedProfiles());
				control.addEventListener('change', () => {
					renderNamedProfiles();
					persistCurrentProfile();
				});
			});
			allElements.innerHTML = '';
			allElements.classList.remove('is-empty');
			allElements.appendChild(node);
			currentControlsNode = node;
			renderNamedProfiles();
			updateSiteFooter();
		}
	}

browser.runtime.onMessage.addListener((message, sender) => {
	if (message?.action !== 'mediaElementsChanged' || !noMediaStateVisible) return undefined;
	if (sender.tab?.id !== tid) return undefined;

	stopAutoMediaScan();
	scheduleAutoMediaScan(0);
	return undefined;
});

window.addEventListener('unload', stopAutoMediaScan);
window.addEventListener('unload', () => {
	clearTimeout(footerFeedbackTimer);
});

browser.tabs.query({ currentWindow: true, active: true }).then(tabs => {
	activeTab = tabs[0];
	tid = activeTab.id;
	return Promise.all([
		scanMedia(),
		loadSiteProfileStatus(),
		loadSiteExceptionStatus(),
		loadNamedProfilesStatus()
	]).then(([frameResults, profileStatus, exceptionStatus, profilesStatus]) => {
		siteProfileStatus = profileStatus;
		siteExceptionStatus = exceptionStatus;
		namedProfilesStatus = profilesStatus;
		renderFrameResults(frameResults);
	}).catch(err => {
		console.error('Error scanning media:', err);
		noMediaStateVisible = false;
		stopAutoMediaScan();
		allElements.innerHTML = '';
		allElements.classList.add('is-empty');
		allElements.appendChild(createEmptyState(
			'Unable to scan this page',
			'The page may not allow extension access. Try again after reloading it.'
		));
		updateSiteFooter();
	});
});
