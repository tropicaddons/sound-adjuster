const gainSlider = document.getElementById("gain");
const panSlider = document.getElementById("pan");
const gainValueDisplay = document.getElementById("gain-value");
const panValueDisplay = document.getElementById("pan-value");

// Gain kontrolü
gainSlider.addEventListener("input", () => {
  const gainValue = parseFloat(gainSlider.value);
  gainValueDisplay.textContent = gainValue.toFixed(1);

  // Aktif sekmeye mesaj gönder
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "setGain", gain: gainValue });
  });
});

// Pan kontrolü
panSlider.addEventListener("input", () => {
  const panValue = parseFloat(panSlider.value);
  panValueDisplay.textContent = panValue.toFixed(1);

  // Aktif sekmeye mesaj gönder
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "setPan", pan: panValue });
  });
});
