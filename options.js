'use strict';

const exceptionsList = document.querySelector('.exceptions-list');
const emptyMessage = document.querySelector('.empty-message');
const clearButton = document.querySelector('.clear-button');
const statusText = document.querySelector('.options-status');

function setStatus(text, state = 'idle') {
	statusText.textContent = text;
	statusText.dataset.state = state;
}

async function loadExceptions() {
	try {
		const result = await browser.runtime.sendMessage({ action: 'listSiteExceptions' });
		renderExceptions(result?.sites || []);
		setStatus('');
	} catch (error) {
		console.warn('Unable to load site exceptions:', error);
		setStatus('Couldn’t load site exceptions.', 'error');
	}
}

async function removeException(siteKey, button) {
	button.disabled = true;
	try {
		const result = await browser.runtime.sendMessage({
			action: 'removeSiteExceptionByKey',
			siteKey
		});
		renderExceptions(result?.sites || []);
		setStatus(`${siteKey} was enabled. Reload an open tab to reconnect Sound Adjuster.`);
	} catch (error) {
		console.warn('Unable to remove the site exception:', error);
		button.disabled = false;
		setStatus(`Couldn’t enable ${siteKey}.`, 'error');
	}
}

function renderExceptions(sites) {
	exceptionsList.replaceChildren();
	emptyMessage.hidden = sites.length !== 0;
	clearButton.hidden = sites.length === 0;

	for (const siteKey of sites) {
		const row = document.createElement('li');
		row.className = 'exception-row';

		const label = document.createElement('span');
		label.className = 'site-key';
		label.textContent = siteKey;
		label.title = siteKey;

		const removeButton = document.createElement('button');
		removeButton.type = 'button';
		removeButton.className = 'remove-button';
		removeButton.textContent = 'Remove';
		removeButton.setAttribute('aria-label', `Remove ${siteKey} from site exceptions`);
		removeButton.addEventListener('click', () => removeException(siteKey, removeButton));

		row.append(label, removeButton);
		exceptionsList.appendChild(row);
	}
}

clearButton.addEventListener('click', async () => {
	if (!confirm('Enable Sound Adjuster on every disabled site?')) return;
	clearButton.disabled = true;
	try {
		await browser.runtime.sendMessage({ action: 'clearSiteExceptions' });
		renderExceptions([]);
		setStatus('All site exceptions were removed. Reload open tabs to reconnect Sound Adjuster.');
	} catch (error) {
		console.warn('Unable to clear site exceptions:', error);
		setStatus('Couldn’t clear site exceptions.', 'error');
	} finally {
		clearButton.disabled = false;
	}
});

browser.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local' || !changes['soundAdjuster.siteExceptions.v1']) return;
	loadExceptions();
});

loadExceptions();
