'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const NARRATOR_STORAGE_KEY = 'gtha-narrator-preferences';

export type NarratorLanguage = 'en' | 'zh' | 'both';
export type NarratorSpokenLanguage = 'en' | 'zh';

export interface NarratorSettings {
  enabled: boolean;
  language: NarratorLanguage;
  englishVoiceURI: string;
  cantoneseVoiceURI: string;
  rate: number;
  pitch: number;
  quiet: boolean;
}

export const DEFAULT_NARRATOR_SETTINGS: Readonly<NarratorSettings> = Object.freeze({
  enabled: false,
  language: 'en',
  englishVoiceURI: '',
  cantoneseVoiceURI: '',
  rate: 1,
  pitch: 1,
  quiet: false,
});

export interface NarratorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NarratorVoice {
  default: boolean;
  lang: string;
  localService: boolean;
  name: string;
  voiceURI: string;
}

export interface NarratorUtterance {
  lang: string;
  pitch: number;
  rate: number;
  voice: NarratorVoice | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface NarratorSynthesizer {
  speak(utterance: NarratorUtterance): void;
  cancel(): void;
}

export interface NarratorPlatform {
  synthesizer: NarratorSynthesizer;
  createUtterance(text: string): NarratorUtterance;
  getVoices(): NarratorVoice[];
  listenForVoices?(listener: () => void): () => void;
}

export interface NarrationRequest {
  category: string;
  en: string;
  zh: string;
  critical?: boolean;
}

export interface VoiceResolution {
  voice: NarratorVoice | null;
  missingSelection: boolean;
  usingAutomaticFallback: boolean;
  networkBacked: boolean;
}

export interface NarratorQueueConfiguration {
  enabled: boolean;
  quiet: boolean;
  language: NarratorLanguage;
  rate: number;
  pitch: number;
  voiceFor(language: NarratorSpokenLanguage): NarratorVoice | null;
}

export interface NarratorQueueOptions {
  debounceMs?: number;
  cooldownMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

type QueueItem = {
  category: string;
  critical: boolean;
  language: NarratorSpokenLanguage;
  text: string;
};

type ActiveNarration = {
  item: QueueItem;
  run: number;
};

const defaultQueueConfiguration: NarratorQueueConfiguration = {
  enabled: false,
  quiet: false,
  language: 'en',
  rate: 1,
  pitch: 1,
  voiceFor: () => null,
};

const clamp = (value: unknown, lower: number, upper: number, fallback: number) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(upper, Math.max(lower, number));
};

const boundedString = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const browserStorage = (): NarratorStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function normalizeNarratorSettings(value: unknown): NarratorSettings {
  const raw = isRecord(value) ? value : {};
  const language = raw.language;
  return {
    enabled: raw.enabled === true,
    language:
      language === 'en' || language === 'zh' || language === 'both'
        ? language
        : DEFAULT_NARRATOR_SETTINGS.language,
    englishVoiceURI: boundedString(raw.englishVoiceURI, 1024),
    cantoneseVoiceURI: boundedString(raw.cantoneseVoiceURI, 1024),
    rate: clamp(raw.rate, 0.1, 10, DEFAULT_NARRATOR_SETTINGS.rate),
    pitch: clamp(raw.pitch, 0, 2, DEFAULT_NARRATOR_SETTINGS.pitch),
    quiet: raw.quiet === true,
  };
}

export function readNarratorSettings(
  storage: NarratorStorage | null | undefined,
): NarratorSettings {
  if (!storage) return { ...DEFAULT_NARRATOR_SETTINGS };
  const stored = storage.getItem(NARRATOR_STORAGE_KEY);
  if (!stored) return { ...DEFAULT_NARRATOR_SETTINGS };
  try {
    return normalizeNarratorSettings(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_NARRATOR_SETTINGS };
  }
}

export function writeNarratorSettings(
  storage: NarratorStorage | null | undefined,
  settings: NarratorSettings,
) {
  if (!storage) return;
  storage.setItem(
    NARRATOR_STORAGE_KEY,
    JSON.stringify(normalizeNarratorSettings(settings)),
  );
}

export function supportsNarratorLanguage(
  voice: NarratorVoice,
  language: NarratorSpokenLanguage,
) {
  const tag = voice.lang.toLowerCase().replace('_', '-');
  if (language === 'en') return tag.startsWith('en');
  return tag.startsWith('yue') || tag.startsWith('zh-hk');
}

function voiceRank(voice: NarratorVoice, language: NarratorSpokenLanguage) {
  const tag = voice.lang.toLowerCase().replace('_', '-');
  let score = 0;
  if (language === 'en' && (tag === 'en-ca' || tag.startsWith('en-ca-')))
    score += 12;
  if (language === 'zh' && tag.startsWith('yue')) score += 16;
  if (language === 'zh' && tag.startsWith('zh-hk')) score += 12;
  if (voice.default) score += 4;
  if (voice.localService) score += 2;
  return score;
}

export function resolveNarratorVoice(
  voices: NarratorVoice[],
  language: NarratorSpokenLanguage,
  selectedVoiceURI: string,
): VoiceResolution {
  const candidates = voices
    .filter((voice) => supportsNarratorLanguage(voice, language))
    .sort((a, b) => voiceRank(b, language) - voiceRank(a, language));
  const selected = selectedVoiceURI
    ? candidates.find((voice) => voice.voiceURI === selectedVoiceURI) || null
    : null;
  const voice = selected || candidates[0] || null;
  return {
    voice,
    missingSelection: Boolean(selectedVoiceURI && !selected),
    usingAutomaticFallback: Boolean(selectedVoiceURI && !selected && voice),
    networkBacked: voice?.localService === false,
  };
}

function createBrowserNarratorPlatform(): NarratorPlatform | null {
  if (
    typeof window === 'undefined' ||
    !window.speechSynthesis ||
    typeof window.SpeechSynthesisUtterance !== 'function'
  )
    return null;

  const speech = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  return {
    synthesizer: {
      speak: (utterance) =>
        speech.speak(utterance as unknown as SpeechSynthesisUtterance),
      cancel: () => speech.cancel(),
    },
    createUtterance: (text) =>
      new Utterance(text) as unknown as NarratorUtterance,
    getVoices: () =>
      speech
        .getVoices()
        .map((voice) => voice as unknown as NarratorVoice),
    listenForVoices: (listener) => {
      if (typeof speech.addEventListener === 'function') {
        speech.addEventListener('voiceschanged', listener);
        return () => speech.removeEventListener('voiceschanged', listener);
      }
      const bridge = speech as unknown as {
        onvoiceschanged: (() => void) | null;
      };
      const previous = bridge.onvoiceschanged;
      bridge.onvoiceschanged = () => {
        previous?.();
        listener();
      };
      return () => {
        bridge.onvoiceschanged = previous;
      };
    },
  };
}

export class NarratorQueue {
  private readonly platform: NarratorPlatform;
  private readonly debounceMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private configuration = defaultQueueConfiguration;
  private queue: QueueItem[] = [];
  private active: ActiveNarration | null = null;
  private timers = new Map<string, unknown>();
  private lastSpoken = new Map<string, number>();
  private nextRun = 0;
  private destroyed = false;

  constructor(
    platform: NarratorPlatform,
    options: NarratorQueueOptions = {},
  ) {
    this.platform = platform;
    this.debounceMs = Math.max(0, options.debounceMs ?? 300);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 10000);
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer =
      options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer as number));
  }

  configure(next: NarratorQueueConfiguration) {
    const shouldStop =
      (this.configuration.enabled && !next.enabled) ||
      (!this.configuration.quiet && next.quiet);
    this.configuration = next;
    if (shouldStop) this.stop();
  }

  announce(request: NarrationRequest) {
    if (
      this.destroyed ||
      !this.configuration.enabled ||
      this.configuration.quiet
    )
      return false;

    const category = boundedString(request.category, 80);
    if (!category) return false;
    const normalized: NarrationRequest = {
      category,
      en: boundedString(request.en, 1200),
      zh: boundedString(request.zh, 1200),
      critical: request.critical === true,
    };
    const alreadyPresent = this.hasCategory(category);
    const last = this.lastSpoken.get(category);
    if (
      !normalized.critical &&
      !alreadyPresent &&
      last !== undefined &&
      this.now() - last < this.cooldownMs
    )
      return false;

    const priorTimer = this.timers.get(category);
    if (priorTimer !== undefined) {
      this.clearTimer(priorTimer);
      this.timers.delete(category);
    }

    const enqueue = () => {
      this.timers.delete(category);
      if (
        this.destroyed ||
        !this.configuration.enabled ||
        this.configuration.quiet
      )
        return;
      const replacing = this.hasCategory(category);
      const lastSpoken = this.lastSpoken.get(category);
      if (
        !normalized.critical &&
        !replacing &&
        lastSpoken !== undefined &&
        this.now() - lastSpoken < this.cooldownMs
      )
        return;
      const items = this.itemsFor(normalized);
      if (!items.length) return;
      this.replaceCategory(category, items, normalized.critical === true);
    };

    if (normalized.critical || alreadyPresent || this.debounceMs === 0) {
      enqueue();
    } else {
      this.timers.set(category, this.setTimer(enqueue, this.debounceMs));
    }
    return true;
  }

  stop() {
    for (const timer of this.timers.values()) this.clearTimer(timer);
    this.timers.clear();
    this.queue = [];
    const hadActive = this.active !== null;
    this.active = null;
    if (hadActive) this.platform.synthesizer.cancel();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
  }

  private hasCategory(category: string) {
    return (
      this.timers.has(category) ||
      this.active?.item.category === category ||
      this.queue.some((item) => item.category === category)
    );
  }

  private itemsFor(request: NarrationRequest): QueueItem[] {
    const languages: NarratorSpokenLanguage[] =
      this.configuration.language === 'both'
        ? ['en', 'zh']
        : [this.configuration.language];
    return languages.flatMap((language) => {
      const text = language === 'en' ? request.en : request.zh;
      if (!text || !this.configuration.voiceFor(language)) return [];
      return [
        {
          category: request.category,
          critical: request.critical === true,
          language,
          text,
        },
      ];
    });
  }

  private replaceCategory(
    category: string,
    items: QueueItem[],
    critical: boolean,
  ) {
    this.queue = this.queue.filter((item) => item.category !== category);
    const replacingActive = this.active?.item.category === category;
    if (replacingActive) {
      this.active = null;
      this.platform.synthesizer.cancel();
      this.queue = [...items, ...this.queue];
    } else if (critical) {
      this.queue = [...items, ...this.queue];
    } else {
      this.queue.push(...items);
    }
    this.playNext();
  }

  private playNext() {
    if (
      this.destroyed ||
      this.active ||
      !this.configuration.enabled ||
      this.configuration.quiet
    )
      return;
    const item = this.queue.shift();
    if (!item) return;
    const voice = this.configuration.voiceFor(item.language);
    if (!voice) {
      this.playNext();
      return;
    }

    const utterance = this.platform.createUtterance(item.text);
    utterance.lang = item.language === 'en' ? 'en-CA' : 'yue-HK';
    utterance.rate = this.configuration.rate;
    utterance.pitch = this.configuration.pitch;
    utterance.voice = voice;
    const run = ++this.nextRun;
    this.active = { item, run };
    this.lastSpoken.set(item.category, this.now());
    utterance.onend = () => this.finish(run);
    utterance.onerror = () => this.finish(run);

    try {
      this.platform.synthesizer.speak(utterance);
    } catch {
      this.finish(run);
    }
  }

  private finish(run: number) {
    if (this.active?.run !== run) return;
    this.active = null;
    this.playNext();
  }
}

export interface UseNarratorOptions {
  platform?: NarratorPlatform | null;
  storage?: NarratorStorage | null;
  debounceMs?: number;
  cooldownMs?: number;
}

export interface NarratorController {
  announce(request: NarrationRequest): boolean;
  cantoneseVoice: VoiceResolution;
  englishVoice: VoiceResolution;
  settings: NarratorSettings;
  speechAvailable: boolean;
  storageUnavailable: boolean;
  updateSettings(patch: Partial<NarratorSettings>): void;
  voices: NarratorVoice[];
  voicesLoaded: boolean;
}

export function useNarrator(options: UseNarratorOptions = {}): NarratorController {
  const [platform, setPlatform] = useState<NarratorPlatform | null>(
    options.platform ?? null,
  );
  const [settings, setSettings] = useState<NarratorSettings>({
    ...DEFAULT_NARRATOR_SETTINGS,
  });
  const [voices, setVoices] = useState<NarratorVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const queue = useRef<NarratorQueue | null>(null);

  useEffect(() => {
    const next = options.platform ?? createBrowserNarratorPlatform();
    const timer = globalThis.setTimeout(() => setPlatform(next), 0);
    return () => globalThis.clearTimeout(timer);
  }, [options.platform]);

  useEffect(() => {
    let active = true;
    const timer = globalThis.setTimeout(() => {
      if (!active) return;
      const storage =
        options.storage === undefined ? browserStorage() : options.storage;
      if (!storage) {
        setStorageUnavailable(true);
        setSettingsLoaded(true);
        return;
      }
      try {
        setSettings(readNarratorSettings(storage));
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      } finally {
        setSettingsLoaded(true);
      }
    }, 0);
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
    };
  }, [options.storage]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let active = true;
    const timer = globalThis.setTimeout(() => {
      if (!active) return;
      const storage =
        options.storage === undefined ? browserStorage() : options.storage;
      if (!storage) {
        setStorageUnavailable(true);
        return;
      }
      try {
        writeNarratorSettings(storage, settings);
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
    }, 0);
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
    };
  }, [options.storage, settings, settingsLoaded]);

  useEffect(() => {
    if (!platform) {
      const timer = globalThis.setTimeout(() => {
        setVoices([]);
        setVoicesLoaded(false);
      }, 0);
      return () => globalThis.clearTimeout(timer);
    }
    let active = true;
    const refresh = () => {
      if (!active) return;
      setVoices(platform.getVoices());
      setVoicesLoaded(true);
    };
    const timer = globalThis.setTimeout(refresh, 0);
    const unsubscribe = platform.listenForVoices?.(refresh);
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [platform]);

  const englishVoice = useMemo(
    () => resolveNarratorVoice(voices, 'en', settings.englishVoiceURI),
    [settings.englishVoiceURI, voices],
  );
  const cantoneseVoice = useMemo(
    () => resolveNarratorVoice(voices, 'zh', settings.cantoneseVoiceURI),
    [settings.cantoneseVoiceURI, voices],
  );

  useEffect(() => {
    if (!platform) {
      queue.current = null;
      return;
    }
    const next = new NarratorQueue(platform, {
      debounceMs: options.debounceMs,
      cooldownMs: options.cooldownMs,
    });
    queue.current = next;
    return () => {
      next.destroy();
      if (queue.current === next) queue.current = null;
    };
  }, [options.cooldownMs, options.debounceMs, platform]);

  useEffect(() => {
    queue.current?.configure({
      enabled: settings.enabled,
      quiet: settings.quiet,
      language: settings.language,
      rate: settings.rate,
      pitch: settings.pitch,
      voiceFor: (language) =>
        language === 'en' ? englishVoice.voice : cantoneseVoice.voice,
    });
  }, [cantoneseVoice.voice, englishVoice.voice, settings]);

  const updateSettings = useCallback((patch: Partial<NarratorSettings>) => {
    setSettings((current) => normalizeNarratorSettings({ ...current, ...patch }));
  }, []);

  const announce = useCallback(
    (request: NarrationRequest) => queue.current?.announce(request) ?? false,
    [],
  );

  return {
    announce,
    cantoneseVoice,
    englishVoice,
    settings,
    speechAvailable: platform !== null,
    storageUnavailable,
    updateSettings,
    voices,
    voicesLoaded,
  };
}
