import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NARRATOR_SETTINGS,
  NarratorQueue,
  normalizeNarratorSettings,
  readNarratorSettings,
  resolveNarratorVoice,
} from '../lib/narrator.ts';

function voice(name, lang, options = {}) {
  return {
    default: options.default === true,
    lang,
    localService: options.localService !== false,
    name,
    voiceURI: options.voiceURI || name + '-' + lang,
  };
}

function fakePlatform() {
  const state = {
    active: null,
    cancelled: 0,
    spoken: [],
  };
  const platform = {
    synthesizer: {
      speak(utterance) {
        state.active = utterance;
        state.spoken.push(utterance);
      },
      cancel() {
        state.cancelled++;
        const interrupted = state.active;
        state.active = null;
        interrupted?.onend?.();
      },
    },
    createUtterance(text) {
      return {
        lang: '',
        onend: null,
        onerror: null,
        pitch: 1,
        rate: 1,
        text,
        voice: null,
      };
    },
    getVoices() {
      return [];
    },
  };
  return {
    finish() {
      const active = state.active;
      state.active = null;
      active?.onend?.();
    },
    platform,
    state,
  };
}

function fakeClock() {
  let current = 0;
  let identifier = 0;
  const timers = new Map();
  const flush = () => {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, entry]) => entry.at <= current)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      timers.delete(due[0]);
      due[1].callback();
    }
  };
  return {
    advance(milliseconds) {
      current += milliseconds;
      flush();
    },
    clearTimer(id) {
      timers.delete(id);
    },
    now() {
      return current;
    },
    setTimer(callback, delay) {
      const id = ++identifier;
      timers.set(id, { at: current + delay, callback });
      return id;
    },
  };
}

function queueFor(platform, clock, language = 'en') {
  const english = voice('Canadian English', 'en-CA', {
    default: true,
    voiceURI: 'english',
  });
  const cantonese = voice('Hong Kong Cantonese', 'yue-HK', {
    default: true,
    voiceURI: 'cantonese',
  });
  const queue = new NarratorQueue(platform, {
    clearTimer: clock.clearTimer,
    cooldownMs: 1000,
    debounceMs: 0,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  queue.configure({
    enabled: true,
    language,
    pitch: 1,
    quiet: false,
    rate: 1,
    voiceFor: (spokenLanguage) =>
      spokenLanguage === 'en' ? english : cantonese,
  });
  return queue;
}

test('Both mode serializes English before Cantonese through the platform boundary', () => {
  const speaker = fakePlatform();
  const clock = fakeClock();
  const queue = queueFor(speaker.platform, clock, 'both');

  assert.equal(
    queue.announce({
      category: 'journey-ready',
      en: 'Two journey options are ready.',
      zh: '已準備好兩個行程選項。',
    }),
    true,
  );
  assert.equal(speaker.state.spoken.length, 1);
  assert.equal(speaker.state.spoken[0].text, 'Two journey options are ready.');
  assert.equal(speaker.state.spoken[0].lang, 'en-CA');

  speaker.finish();
  assert.equal(speaker.state.spoken.length, 2);
  assert.equal(speaker.state.spoken[1].text, '已準備好兩個行程選項。');
  assert.equal(speaker.state.spoken[1].lang, 'yue-HK');

  speaker.finish();
  assert.equal(speaker.state.active, null);
});

test('A newer message replaces an active message in the same category', () => {
  const speaker = fakePlatform();
  const clock = fakeClock();
  const queue = queueFor(speaker.platform, clock);

  queue.announce({
    category: 'service-status',
    en: 'The service status is refreshing.',
    zh: '正在更新服務狀態。',
  });
  queue.announce({
    category: 'service-status',
    en: 'The service status is ready.',
    zh: '服務狀態已更新。',
  });

  assert.equal(speaker.state.cancelled, 1);
  assert.deepEqual(
    speaker.state.spoken.map((utterance) => utterance.text),
    ['The service status is refreshing.', 'The service status is ready.'],
  );
  assert.equal(speaker.state.active.text, 'The service status is ready.');
});

test('Cooldown limits ordinary repeats while critical messages bypass it', () => {
  const speaker = fakePlatform();
  const clock = fakeClock();
  const queue = queueFor(speaker.platform, clock);

  assert.equal(
    queue.announce({
      category: 'journey-ready',
      en: 'A journey is ready.',
      zh: '行程已準備好。',
    }),
    true,
  );
  speaker.finish();
  assert.equal(
    queue.announce({
      category: 'journey-ready',
      en: 'A second journey is ready.',
      zh: '第二個行程已準備好。',
    }),
    false,
  );
  assert.equal(
    queue.announce({
      category: 'journey-error',
      critical: true,
      en: 'Journey planning could not complete.',
      zh: '未能完成行程規劃。',
    }),
    true,
  );
  speaker.finish();
  clock.advance(1000);
  assert.equal(
    queue.announce({
      category: 'journey-ready',
      en: 'A second journey is ready.',
      zh: '第二個行程已準備好。',
    }),
    true,
  );
});

test('Quiet narration and disablement stop active speech and reject new requests', () => {
  const speaker = fakePlatform();
  const clock = fakeClock();
  const queue = queueFor(speaker.platform, clock);

  queue.announce({
    category: 'saved-trip',
    en: 'Trip saved on this device.',
    zh: '行程已儲存喺呢部裝置。',
  });
  queue.configure({
    enabled: true,
    language: 'en',
    pitch: 1,
    quiet: true,
    rate: 1,
    voiceFor: () => voice('Canadian English', 'en-CA'),
  });
  assert.equal(speaker.state.cancelled, 1);
  assert.equal(
    queue.announce({
      category: 'saved-trip',
      en: 'Trip saved on this device.',
      zh: '行程已儲存喺呢部裝置。',
    }),
    false,
  );

  queue.configure({
    enabled: false,
    language: 'en',
    pitch: 1,
    quiet: false,
    rate: 1,
    voiceFor: () => voice('Canadian English', 'en-CA'),
  });
  assert.equal(
    queue.announce({
      category: 'saved-trip',
      en: 'Trip saved on this device.',
      zh: '行程已儲存喺呢部裝置。',
    }),
    false,
  );
});

test('Voice matching preserves a missing choice and never substitutes generic Chinese for Cantonese', () => {
  const english = voice('Canadian English', 'en-CA', {
    voiceURI: 'english',
  });
  const cantonese = voice('Hong Kong Cantonese', 'yue-HK', {
    localService: false,
    voiceURI: 'cantonese',
  });
  const genericChinese = voice('Generic Chinese', 'zh-CN', {
    voiceURI: 'generic-chinese',
  });
  const missing = resolveNarratorVoice([english], 'en', 'former-english');
  assert.equal(missing.missingSelection, true);
  assert.equal(missing.usingAutomaticFallback, true);
  assert.equal(missing.voice.voiceURI, 'english');

  const network = resolveNarratorVoice([cantonese], 'zh', '');
  assert.equal(network.voice.voiceURI, 'cantonese');
  assert.equal(network.networkBacked, true);

  const noCantonese = resolveNarratorVoice([genericChinese], 'zh', '');
  assert.equal(noCantonese.voice, null);
});

test('Narrator settings remain off by default and validate persisted bounds', () => {
  assert.equal(DEFAULT_NARRATOR_SETTINGS.enabled, false);
  assert.deepEqual(
    normalizeNarratorSettings({
      enabled: true,
      englishVoiceURI: 'english',
      language: 'both',
      pitch: -4,
      rate: 100,
    }),
    {
      enabled: true,
      englishVoiceURI: 'english',
      cantoneseVoiceURI: '',
      language: 'both',
      pitch: 0,
      quiet: false,
      rate: 10,
    },
  );
  assert.deepEqual(
    readNarratorSettings({
      getItem() {
        return '{not valid JSON';
      },
      setItem() {},
    }),
    { ...DEFAULT_NARRATOR_SETTINGS },
  );
});

test('Automatic voice choice prefers a local voice while honoring an explicit network voice', () => {
  const local = voice('Local English', 'en-US', { voiceURI: 'local', localService: true });
  const network = voice('Canadian English', 'en-CA', { voiceURI: 'network', localService: false, default: true });
  assert.equal(resolveNarratorVoice([network, local], 'en', '').voice.voiceURI, 'local');
  const selected = resolveNarratorVoice([network, local], 'en', 'network');
  assert.equal(selected.voice.voiceURI, 'network');
  assert.equal(selected.networkBacked, true);
});
