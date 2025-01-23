const gainSlider = document.getElementById("gain");
const panSlider = document.getElementById("pan");
const gainValueDisplay = document.getElementById("gain-value");
const panValueDisplay = document.getElementById("pan-value");
const gainInput = document.getElementById("gain-input");
const themeToggle = document.getElementById("theme-toggle");

// Theme toggle
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
  const isLightTheme = document.body.classList.contains("light-theme");
  localStorage.setItem("theme", isLightTheme ? "light" : "dark");
});

// Set theme on page load
document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light-theme");
  }

  // Update slider fill on initial load
  const sliders = document.querySelectorAll('input[type="range"]');
  sliders.forEach(slider => {
    const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-value', `${value}%`);
  });
});

// Interaction between gain slider and input box
gainSlider.addEventListener("input", () => {
  const gainValue = parseFloat(gainSlider.value);
  gainValueDisplay.textContent = gainValue.toFixed(1);
  gainInput.value = gainValue;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "setGain", gain: gainValue });
  });

  // Update slider fill
  const value = (gainSlider.value - gainSlider.min) / (gainSlider.max - gainSlider.min) * 100;
  gainSlider.style.setProperty('--slider-value', `${value}%`);
});

gainInput.addEventListener("input", () => {
  const gainValue = parseFloat(gainInput.value);
  gainSlider.value = gainValue;
  gainValueDisplay.textContent = gainValue.toFixed(1);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "setGain", gain: gainValue });
  });

  // Update slider fill
  const value = (gainSlider.value - gainSlider.min) / (gainSlider.max - gainSlider.min) * 100;
  gainSlider.style.setProperty('--slider-value', `${value}%`);
});

// Pan slider control
panSlider.addEventListener("input", () => {
  const panValue = parseFloat(panSlider.value);
  panValueDisplay.textContent = panValue.toFixed(1);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "setPan", pan: panValue });
  });

  // Update slider fill
  const value = (panSlider.value - panSlider.min) / (panSlider.max - panSlider.min) * 100;
  panSlider.style.setProperty('--slider-value', `${value}%`);
});

// Update slider fill
const sliders = document.querySelectorAll('input[type="range"]');
sliders.forEach(slider => {
  slider.addEventListener('input', () => {
    const value = (slider.value - slider.min) / (slider.max - slider.min) * 100;
    slider.style.setProperty('--slider-value', `${value}%`);
  });
});

// Update input box style
document.querySelectorAll('input[type="number"]').forEach(input => {
  input.addEventListener('focus', () => {
    input.style.border = `2px solid var(--slider-thumb-hover)`;
    input.style.boxShadow = '0 0 8px rgba(255, 170, 51, 0.8)';
    input.style.color = 'var(--text-color)';
    input.style.background = 'var(--slider-bg)';
  });

  input.addEventListener('blur', () => {
    input.style.border = `1px solid var(--text-color)`;
    input.style.boxShadow = 'none';
    input.style.color = 'var(--text-color)';
    input.style.background = 'var(--slider-bg)';
  });
});