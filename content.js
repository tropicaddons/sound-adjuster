<<<<<<< HEAD
let audioContext;
let gainNode;
let panNode;

// AudioContext'i başlat
function setupAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    gainNode = audioContext.createGain();
    panNode = audioContext.createStereoPanner();

    gainNode.connect(panNode).connect(audioContext.destination);
  }
}

// Yeni video elementlerini bağla
function attachToVideos() {
  const mediaElements = document.querySelectorAll("video");
  mediaElements.forEach((video) => {
    if (!video.hasAttribute("data-audio-connected")) {
      try {
        // Cross-origin sorunlarını aşmak için
        video.crossOrigin = "anonymous";
        const source = audioContext.createMediaElementSource(video);
        source.connect(gainNode);
        video.setAttribute("data-audio-connected", "true");
        console.log("Video bağlandı:", video);
      } catch (e) {
        console.warn("Cross-origin nedeniyle video bağlanamadı:", video, e);
      }
    }
  });
}

// MutationObserver ile yeni videoları takip et
function observeNewVideos() {
  const observer = new MutationObserver(() => {
    attachToVideos(); // Yeni eklenen videoları bağla
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Mesajları dinle ve ayarları uygula
chrome.runtime.onMessage.addListener((message) => {
  setupAudioContext();
  attachToVideos();

  if (message.action === "setGain") {
    gainNode.gain.value = message.gain;
    console.log(`Gain ayarlandı: ${message.gain}`);
  } else if (message.action === "setPan") {
    panNode.pan.value = message.pan;
    console.log(`Pan ayarlandı: ${message.pan}`);
  }
});

// Başlangıç ayarları
setupAudioContext();
attachToVideos();
observeNewVideos();
=======
let audioContext;
let gainNode;
let panNode;

// AudioContext'i başlat
function setupAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    gainNode = audioContext.createGain();
    panNode = audioContext.createStereoPanner();

    gainNode.connect(panNode).connect(audioContext.destination);
  }
}

// Yeni video elementlerini bağla
function attachToVideos() {
  const mediaElements = document.querySelectorAll("video");
  mediaElements.forEach((video) => {
    if (!video.hasAttribute("data-audio-connected")) {
      try {
        // Cross-origin sorunlarını aşmak için
        video.crossOrigin = "anonymous";
        const source = audioContext.createMediaElementSource(video);
        source.connect(gainNode);
        video.setAttribute("data-audio-connected", "true");
        console.log("Video bağlandı:", video);
      } catch (e) {
        console.warn("Cross-origin nedeniyle video bağlanamadı:", video, e);
      }
    }
  });
}

// MutationObserver ile yeni videoları takip et
function observeNewVideos() {
  const observer = new MutationObserver(() => {
    attachToVideos(); // Yeni eklenen videoları bağla
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Mesajları dinle ve ayarları uygula
chrome.runtime.onMessage.addListener((message) => {
  setupAudioContext();
  attachToVideos();

  if (message.action === "setGain") {
    gainNode.gain.value = message.gain;
    console.log(`Gain ayarlandı: ${message.gain}`);
  } else if (message.action === "setPan") {
    panNode.pan.value = message.pan;
    console.log(`Pan ayarlandı: ${message.pan}`);
  }
});

// Başlangıç ayarları
setupAudioContext();
attachToVideos();
observeNewVideos();
>>>>>>> sound-adjuster-1.1
