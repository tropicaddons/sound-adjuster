let audioContext;
let gainNode;
let panNode;

// Initialize AudioContext
function setupAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    gainNode = audioContext.createGain();
    panNode = audioContext.createStereoPanner();

    gainNode.connect(panNode).connect(audioContext.destination);
  }
}

// Attach to new video elements
function attachToVideos() {
  const mediaElements = document.querySelectorAll("video");
  mediaElements.forEach((video) => {
    if (!video.hasAttribute("data-audio-connected")) {
      try {
        // To bypass cross-origin issues
        video.crossOrigin = "anonymous";
        const source = audioContext.createMediaElementSource(video);
        source.connect(gainNode);
        video.setAttribute("data-audio-connected", "true");
        console.log("Video connected:", video);
      } catch (e) {
        console.warn("Video could not be connected due to cross-origin:", video, e);
      }
    }
  });
}

// Track new videos with MutationObserver
function observeNewVideos() {
  const observer = new MutationObserver(() => {
    attachToVideos(); // Attach newly added videos
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Listen to messages and apply settings
chrome.runtime.onMessage.addListener((message) => {
  setupAudioContext();
  attachToVideos();

  if (message.action === "setGain") {
    gainNode.gain.value = message.gain;
    console.log(`Gain set to: ${message.gain}`);
  } else if (message.action === "setPan") {
    panNode.pan.value = message.pan;
    console.log(`Pan set to: ${message.pan}`);
  }
});

// Initial settings
setupAudioContext();
attachToVideos();
observeNewVideos();