'use strict';

(() => {
  const sessions = new Map();
  const workerUrl = chrome.runtime.getURL('service-worker.js');
  const normalizeSettings = SoundAdjusterPopupState.normalizeSettings;
  const bands = [
    ['eqBass', 'lowshelf', 250],
    ['eqLowMid', 'peaking', 500],
    ['eqMid', 'peaking', 2000],
    ['eqHighMid', 'peaking', 6000],
    ['eqTreble', 'highshelf', 8000]
  ];
  let operations = Promise.resolve();

  function enqueue(operation) {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  }

  function measure(analyser) {
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let squares = 0;
    let peak = 0;
    for (const sample of samples) {
      squares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return { rms: Math.sqrt(squares / samples.length), peak };
  }

  function status(tabId, sessionId) {
    const session = sessions.get(tabId);
    if (!session || session.sessionId !== sessionId) return { success: true, state: 'idle', tabId };
    const { context, input, meter, outputMeter, settings, stream } = session;
    const { peak } = measure(meter);
    return {
      success: true, state: context.state, tabId, sessionId, settings,
      level: { peak: Number(Math.min(2, peak).toFixed(4)), clipping: peak >= 0.98, contextState: context.state },
      inputRms: measure(input).rms, outputRms: measure(outputMeter).rms,
      sampleRate: context.sampleRate, tracks: stream.getAudioTracks().map(track => track.readyState)
    };
  }

  function applySettings(session, changes) {
    const { gain, pan, eq, split, merge, output } = session;
    const settings = normalizeSettings({ ...session.settings, ...changes });
    gain.gain.value = settings.gain;
    pan.pan.value = settings.pan;
    for (const [name, filter] of eq) filter.gain.value = settings[name];
    output.channelCount = settings.mono ? 1 : 2;

    if (session.settings?.flip !== settings.flip) {
      pan.disconnect();
      split.disconnect();
      merge.disconnect();
      if (settings.flip) {
        pan.connect(split);
        split.connect(merge, 0, 1);
        split.connect(merge, 1, 0);
        merge.connect(output);
      } else {
        pan.connect(output);
      }
    }
    session.settings = settings;
  }

  function createGraph(context, stream, sessionId) {
    const source = context.createMediaStreamSource(stream);
    const input = context.createAnalyser();
    const gain = context.createGain();
    const meter = context.createAnalyser();
    const pan = context.createStereoPanner();
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const output = context.createGain();
    const outputMeter = context.createAnalyser();
    output.channelCountMode = 'explicit';
    output.channelInterpretation = 'speakers';
    input.fftSize = outputMeter.fftSize = 2048;
    meter.fftSize = 256;
    meter.smoothingTimeConstant = 0.65;

    const eq = new Map();
    let tail = source.connect(input);
    for (const [name, type, frequency] of bands) {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      if (type === 'peaking') filter.Q.value = 1;
      eq.set(name, filter);
      tail = tail.connect(filter);
    }
    tail.connect(gain).connect(meter).connect(pan);
    output.connect(outputMeter).connect(context.destination);

    return { sessionId, context, stream, source, input, gain, meter, pan, split, merge, output, outputMeter, eq };
  }

  async function stop(tabId, sessionId) {
    const session = sessions.get(tabId);
    if (!session || session.sessionId !== sessionId) return false;
    sessions.delete(tabId);
    for (const track of session.stream.getTracks()) track.stop();
    session.source.disconnect();
    if (session.context.state !== 'closed') await session.context.close().catch(console.warn);
    return true;
  }

  async function start(tabId, sessionId, streamId, settings) {
    const current = sessions.get(tabId);
    if (current?.sessionId === sessionId) return;
    if (current) await stop(tabId, current.sessionId);
    let stream;
    let context;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        video: false
      });
      context = new AudioContext({ latencyHint: 'interactive' });
      const session = createGraph(context, stream, sessionId);
      applySettings(session, settings);
      await context.resume();
      const tracks = stream.getAudioTracks();
      if (context.state !== 'running' || !tracks.some(track => track.readyState === 'live')) {
        throw new Error('The tab audio output did not start.');
      }
      sessions.set(tabId, session);
      for (const track of tracks) {
        track.addEventListener('ended', () => {
          // Send the event after local cleanup releases the queue. The worker
          // can then issue its own cleanup request without deadlocking.
          enqueue(() => stop(tabId, sessionId)).then(stopped => {
            if (!stopped) return;
            return chrome.runtime.sendMessage({
              target: 'sound-adjuster-capture-worker', action: 'ended', tabId, sessionId
            });
          }).catch(console.warn);
        }, { once: true });
      }
    } catch (error) {
      for (const track of stream?.getTracks() || []) track.stop();
      if (context && context.state !== 'closed') await context.close().catch(console.warn);
      throw error;
    }
  }

  async function handle({ action, tabId, sessionId, streamId, settings }) {
    if (action === 'start') await start(tabId, sessionId, streamId, settings);
    if (action === 'stop') await stop(tabId, sessionId);
    if (action === 'apply') {
      const session = sessions.get(tabId);
      if (session?.sessionId === sessionId) applySettings(session, settings);
    }
    return status(tabId, sessionId);
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.target !== 'sound-adjuster-capture-offscreen'
      || sender.id !== chrome.runtime.id || sender.tab || sender.url !== workerUrl) return false;
    if (!Number.isInteger(message.tabId) || message.tabId < 0 || typeof message.sessionId !== 'string'
      || !['status', 'start', 'apply', 'stop'].includes(message.action)
      || message.action === 'start' && typeof message.streamId !== 'string') return false;
    enqueue(() => handle(message)).then(reply, error => reply({ success: false, error: error.message }));
    return true;
  });
})();
