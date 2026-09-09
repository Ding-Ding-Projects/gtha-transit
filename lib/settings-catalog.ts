/**
 * One registry of every setting the planner exposes.
 *
 * It exists because there are now two surfaces that have to know the same list:
 * the settings workspace's own searches, and the command palette. A list written
 * twice is a list that disagrees with itself the first time somebody adds a
 * control to one of them, and the disagreement is silent -- the palette simply
 * cannot find a setting that exists, which reads as the palette being broken
 * rather than as the catalog being short.
 *
 * Entries carry a control descriptor rather than a rendered control, so this file
 * stays free of React and can be tested directly. The descriptor holds the real
 * setter, so a palette row and the settings surface change the same value through
 * the same code: they cannot validate, persist or clamp differently, because
 * there is only one of each.
 *
 * The `unavailable` field is the guided-forms rule applied here: a control that
 * cannot be operated says which condition is unmet, in words, rather than
 * appearing inert and leaving the reader to guess.
 */

export type SettingsSection = 'appearance' | 'language' | 'comfort' | 'narrator' | 'privacy';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['appearance', 'language', 'comfort', 'narrator', 'privacy'];

/**
 * Where the settings workspace remembers which section is open.
 *
 * The palette writes this key too, so teleporting to a narrator control opens the
 * narrator section on the way. It is exported rather than spelled twice because
 * the two writers disagreeing is a teleport that lands on the wrong tab and says
 * nothing about why.
 */
export const SETTINGS_SECTION_KEY = 'gtha-settings-section-v1';

export type SettingsChoice = { value: string; label: string; description?: string };

/** Only the fields this catalog reads. The narrator's own voice type carries more. */
export type SettingsVoice = { voiceURI: string; name: string; lang: string };

export type NarratorSpeech = 'en' | 'zh' | 'both';

export const NARRATOR_LANGUAGES: readonly NarratorSpeech[] = ['en', 'zh', 'both'];

/** The narrator settings this catalog reads and writes, spelled as the narrator spells them. */
export type NarratorSettingsLike = {
  enabled: boolean;
  language: NarratorSpeech;
  englishVoiceURI: string;
  cantoneseVoiceURI: string;
  rate: number;
  pitch: number;
  quiet: boolean;
};

/**
 * What a caller may render inline for an entry.
 *
 * A control of kind `none` is not a failure state. Some entries are prose, and
 * some controls need their own surface's state to mean anything; both say so
 * rather than pretending to be adjustable somewhere they are not.
 */
export type SettingsControl =
  | { kind: 'text'; value: string; maxLength: number; apply: (value: string) => void }
  | { kind: 'choice'; value: string; choices: SettingsChoice[]; apply: (value: string) => void }
  | { kind: 'range'; value: number; min: number; max: number; step: number; apply: (value: number) => void }
  | { kind: 'switch'; value: boolean; apply: (value: boolean) => void }
  | { kind: 'none'; reason: string };

export type SettingsEntry = {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  /** The current value, in words, for search and for the row summary. */
  value?: string;
  /** Where the real control lives, so a teleport lands on the control itself. */
  selector: string;
  control: SettingsControl;
  /** Why the control cannot be operated right now, if it cannot. */
  unavailable?: string;
};

export type Translate = (en: string, zh: string) => string;

export type NarratorLike = {
  settings: NarratorSettingsLike;
  updateSettings: (patch: Partial<NarratorSettingsLike>) => void;
  speechAvailable: boolean;
  voices: readonly SettingsVoice[];
  voicesLoaded: boolean;
};

export type SettingsCatalogInput = {
  t: Translate;
  lang: string;
  setLang: (value: string) => void;
  dark: boolean;
  setDark: (value: boolean) => void;
  funEn: number;
  setFunEn: (value: number) => void;
  funZh: number;
  setFunZh: (value: number) => void;
  narrator: NarratorLike;
  /**
   * The comfort surface, when the caller has one.
   *
   * Optional so a caller that only wants the language and appearance rows -- a
   * test, or a surface that does not host the comfort controls -- is not forced
   * to build state it does not have. When it is absent those rows are simply not
   * in the catalog, rather than being present and inert.
   */
  comfort?: {
    modes: Record<string, boolean>;
    toggleMode: (mode: string) => void;
    vocabularyEntries: number;
  };
  /**
   * School mode, when the caller has it.
   *
   * The catalog is where suppression has to happen rather than at each surface,
   * because the settings search and the command palette both read this list. A
   * row removed from the workspace but left here is a mode that hides a control
   * and then lets the palette teleport straight to it.
   */
  school?: { on: boolean; name: string };
  appearance?: {
    ready?: boolean;
    global: { appName: string | null; seed: string | null; density: string; sizeScale: number; showEmoji: boolean };
    set: (patch: Record<string, unknown>) => void;
  };
};

/**
 * The settings School mode takes away.
 *
 * Named here rather than checked at each row, so a reviewer reads one list and a
 * new language or wording control has one place to join. Every one of these is
 * removed from the catalog while the mode is on, so it leaves the settings search
 * and the command palette together; the mode's own row never joins this list.
 */
export const HIDDEN_BY_SCHOOL: readonly string[] = ['language', 'english-tone', 'cantonese-tone', 'personal-vocabulary'];

/** The playfulness sliders share one shape, and both ship at 5. */
export const TONE_RANGE = Object.freeze({ min: 1, max: 5, step: 1, shipped: 5 });

/** Voices are matched on the language tag prefix, because a platform spells the region a dozen ways. */
export function voicesForLanguage(voices: readonly SettingsVoice[], language: 'en' | 'zh'): SettingsVoice[] {
  return voices.filter((voice) => typeof voice?.lang === 'string' && voice.lang.toLowerCase().startsWith(language));
}

/**
 * Why a voice control cannot be operated, or an empty string when it can.
 *
 * The order matters. No speech synthesis at all is a different sentence from
 * narration being switched off, and telling somebody to turn narration on in a
 * browser that cannot speak wastes their time and teaches them the message is
 * not worth reading.
 */
export function voiceUnavailability(narrator: NarratorLike, t: Translate, language: 'en' | 'zh'): string {
  if (!narrator.speechAvailable) return t('This browser does not provide speech synthesis.', '此瀏覽器未提供語音合成。');
  if (!narrator.settings.enabled) return t('Turn narration on to choose a voice.', '開啟旁白先可以揀語音。');
  if (!narrator.voicesLoaded) return t('The installed voices are still loading.', '已安裝語音仍在載入。');
  if (voicesForLanguage(narrator.voices, language).length === 0) {
    return language === 'en'
      ? t('No English voice is installed on this computer.', '此電腦未安裝英文語音。')
      : t('No Cantonese voice is installed on this computer.', '此電腦未安裝廣東話語音。');
  }
  return '';
}

/** Why a narrator tuning control cannot be operated, or an empty string when it can. */
export function narrationUnavailability(narrator: NarratorLike, t: Translate): string {
  if (!narrator.speechAvailable) return t('This browser does not provide speech synthesis.', '此瀏覽器未提供語音合成。');
  if (!narrator.settings.enabled) return t('Turn narration on to change this.', '開啟旁白先可以更改。');
  return '';
}

/**
 * Every setting, in the order a person reads them.
 *
 * The selectors are exactly the ones the settings workspace renders, which is
 * what makes a teleport land on the control rather than on the page holding it.
 */
export function settingsCatalog(input: SettingsCatalogInput): SettingsEntry[] {
  const { t, lang, setLang, dark, setDark, funEn, setFunEn, funZh, setFunZh, narrator } = input;
  /* Omitted, not disabled: a row that stays in the search saying "Cantonese
     (unavailable)" announces exactly what was turned off. */
  const hidden = input.school?.on === true;
  const narration = narrationUnavailability(narrator, t);
  const englishVoices = voicesForLanguage(narrator.voices, 'en');
  const cantoneseVoices = voicesForLanguage(narrator.voices, 'zh');
  const automatic: SettingsChoice = { value: '', label: t('Choose automatically', '自動選擇') };
  const voiceChoices = (voices: readonly SettingsVoice[]): SettingsChoice[] => [
    automatic,
    ...voices.map((voice) => ({ value: voice.voiceURI, label: voice.name })),
  ];
  /** An empty value means automatic, and so does a stored voice this computer no longer has. */
  const voiceValue = (stored: string, voices: readonly SettingsVoice[]) =>
    stored && voices.some((voice) => voice.voiceURI === stored) ? stored : '';
  const englishVoiceGap = voiceUnavailability(narrator, t, 'en');
  const cantoneseVoiceGap = voiceUnavailability(narrator, t, 'zh');

  const entries: SettingsEntry[] = [
    {
      id: 'theme',
      section: 'appearance',
      label: t('Colour theme', '色彩主題'),
      description: t('Light or dark appearance', '淺色或深色外觀'),
      value: dark ? t('Dark', '深色') : t('Light', '淺色'),
      selector: '#settings-theme-light',
      control: {
        kind: 'choice',
        value: dark ? 'dark' : 'light',
        choices: [
          { value: 'light', label: t('Light', '淺色'), description: t('Bright surfaces and crisp detail', '明亮介面，細節清楚') },
          { value: 'dark', label: t('Dark', '深色'), description: t('Dim surfaces for quieter viewing', '暗色介面，睇得柔和') },
        ],
        apply: (value) => setDark(value === 'dark'),
      },
    },
    {
      id: 'language',
      section: 'language',
      label: t('Language', '語言'),
      description: t('English, Hong Kong Cantonese or both', '英文、香港廣東話或雙語'),
      value: lang,
      selector: '#settings-language-en',
      control: {
        kind: 'choice',
        value: lang,
        choices: [
          { value: 'en', label: 'English', description: t('English throughout the planner', '整個規劃工具使用英文') },
          { value: 'zh', label: '香港廣東話', description: t('Hong Kong Cantonese', '香港廣東話') },
          { value: 'both', label: 'English + 廣東話', description: t('Both languages together', '同時顯示兩種語言') },
        ],
        apply: setLang,
      },
    },
    {
      id: 'english-tone',
      section: 'language',
      label: t('English playfulness', '英文趣味程度'),
      description: t('Independent English tone from serious to playful', '獨立英文語氣，由認真至有趣'),
      value: String(funEn),
      selector: '#settings-english-tone',
      control: { kind: 'range', value: funEn, min: TONE_RANGE.min, max: TONE_RANGE.max, step: TONE_RANGE.step, apply: setFunEn },
    },
    {
      id: 'cantonese-tone',
      section: 'language',
      label: t('Cantonese playfulness', '廣東話趣味程度'),
      description: t('Independent Cantonese tone from serious to playful', '獨立廣東話語氣，由認真至有趣'),
      value: String(funZh),
      selector: '#settings-cantonese-tone',
      control: { kind: 'range', value: funZh, min: TONE_RANGE.min, max: TONE_RANGE.max, step: TONE_RANGE.step, apply: setFunZh },
    },
    /*
     * The mode itself is never hidden, whatever it hides. It is the only way back
     * out, so a search that cannot find it is a person locked out of their own
     * planner by the search box.
     */
    ...(input.school ? [{
      id: 'school-mode', section: 'comfort' as const,
      label: input.school.name,
      description: t('Plain English, with the playful parts put away', '淨係英文，收起玩味嘅部分'),
      value: input.school.on ? t('On', '開') : t('Off', '關'),
      selector: '.school-mode',
      control: {
        kind: 'none' as const,
        reason: t('Turning it on or off is done at the control itself, which asks for your word.', '開關要喺個控制項度做，會問你嗰個字。'),
      },
    }] : []),
    ...(input.comfort ? [
      {
        id: 'comfort-focus', section: 'comfort' as const,
        label: t('Focus', '專注'),
        description: t('Bring what you are working on forward and push the rest back', '突出你做緊嘅嘢，其餘淡化'),
        value: input.comfort.modes.focus ? t('On', '開') : t('Off', '關'),
        selector: '.comfort-mode-list input[type="checkbox"]',
        control: { kind: 'switch' as const, value: input.comfort.modes.focus === true, apply: () => input.comfort!.toggleMode('focus') },
      },
      {
        id: 'comfort-low-stimulation', section: 'comfort' as const,
        label: t('Low stimulation', '低刺激'),
        description: t('Fewer moving things, quieter colour, fewer notifications', '少啲郁動，顏色柔和，通知少啲'),
        value: input.comfort.modes.lowStimulation ? t('On', '開') : t('Off', '關'),
        selector: '.comfort-mode-list input[type="checkbox"]',
        control: { kind: 'switch' as const, value: input.comfort.modes.lowStimulation === true, apply: () => input.comfort!.toggleMode('lowStimulation') },
      },
      {
        id: 'comfort-time-awareness', section: 'comfort' as const,
        label: t('Time awareness', '時間感'),
        description: t('How long this session has been open, and how long since anything changed', '今次開咗幾耐，同幾耐冇改動'),
        value: input.comfort.modes.timeAwareness ? t('On', '開') : t('Off', '關'),
        selector: '.comfort-mode-list input[type="checkbox"]',
        control: { kind: 'switch' as const, value: input.comfort.modes.timeAwareness === true, apply: () => input.comfort!.toggleMode('timeAwareness') },
      },
      {
        id: 'comfort-one-thing', section: 'comfort' as const,
        label: t('One thing at a time', '一次一件事'),
        description: t('Keep one next action visible, chosen by you', '由你揀一件下一步嘅事擺喺眼前'),
        value: input.comfort.modes.oneThing ? t('On', '開') : t('Off', '關'),
        selector: '.comfort-mode-list input[type="checkbox"]',
        control: { kind: 'switch' as const, value: input.comfort.modes.oneThing === true, apply: () => input.comfort!.toggleMode('oneThing') },
      },
      {
        id: 'comfort-momentum', section: 'comfort' as const,
        label: t('Momentum', '節奏'),
        description: t('A quiet, dismissible prompt when something has been sitting untouched', '有嘢擺低咗好耐，靜靜哋提你一句'),
        value: input.comfort.modes.momentum ? t('On', '開') : t('Off', '關'),
        selector: '.comfort-mode-list input[type="checkbox"]',
        control: { kind: 'switch' as const, value: input.comfort.modes.momentum === true, apply: () => input.comfort!.toggleMode('momentum') },
      },
      {
        id: 'personal-vocabulary', section: 'comfort' as const,
        label: t('Your own wording', '你自己嘅用語'),
        description: t('Load a local JSON file of your words and the planner will use them', '載入你自己用語嘅本機 JSON 檔'),
        value: input.comfort.vocabularyEntries > 0
          ? t(`${input.comfort.vocabularyEntries} words in use`, `已套用 ${input.comfort.vocabularyEntries} 個用語`)
          : t('No file loaded', '未載入檔案'),
        selector: '.comfort-vocabulary-picker',
        control: {
          kind: 'none' as const,
          reason: t('Choosing a file is done at the control itself, which opens your own file picker.', '揀檔案要喺個控制項度做，會開你自己嘅檔案選擇器。'),
        },
      },
    ] : []),
    {
      id: 'narration',
      section: 'narrator',
      label: t('Enable narration', '開啟旁白'),
      description: t('Spoken journey updates, off by default', '語音行程提示，預設關閉'),
      value: narrator.settings.enabled ? t('On', '開') : t('Off', '關'),
      selector: '#narrator-enabled',
      control: { kind: 'switch', value: narrator.settings.enabled, apply: (value) => narrator.updateSettings({ enabled: value }) },
      unavailable: narrator.speechAvailable ? undefined : t('This browser does not provide speech synthesis.', '此瀏覽器未提供語音合成。'),
    },
    {
      id: 'narration-language',
      section: 'narrator',
      label: t('Narration language', '旁白語言'),
      description: t('English, Cantonese or both in sequence', '英文、廣東話或依次讀出兩者'),
      value: narrator.settings.language,
      selector: '#narrator-language-en',
      control: {
        kind: 'choice',
        value: narrator.settings.language,
        choices: [
          { value: 'en', label: 'English' },
          { value: 'zh', label: '廣東話' },
          { value: 'both', label: 'English + 廣東話' },
        ],
        apply: (value) => {
          // The choices are built from NARRATOR_LANGUAGES, so this only ever rejects a
          // value nobody could have picked. It is here so a future caller cannot widen
          // the setting by handing in a string the narrator does not understand.
          if ((NARRATOR_LANGUAGES as readonly string[]).includes(value)) narrator.updateSettings({ language: value as NarratorSpeech });
        },
      },
      unavailable: narration || undefined,
    },
    {
      id: 'english-voice',
      section: 'narrator',
      label: t('English voice', '英文語音'),
      description: t('Choose an installed voice or choose automatically', '選擇已安裝語音或自動選擇'),
      value: englishVoices.find((voice) => voice.voiceURI === narrator.settings.englishVoiceURI)?.name ?? t('Choose automatically', '自動選擇'),
      selector: '#narrator-english-voice-automatic',
      control: englishVoiceGap
        ? { kind: 'none', reason: englishVoiceGap }
        : {
            kind: 'choice',
            value: voiceValue(narrator.settings.englishVoiceURI, englishVoices),
            choices: voiceChoices(englishVoices),
            apply: (value) => narrator.updateSettings({ englishVoiceURI: value }),
          },
      unavailable: englishVoiceGap || undefined,
    },
    {
      id: 'cantonese-voice',
      section: 'narrator',
      label: t('Hong Kong Cantonese voice', '香港廣東話語音'),
      description: t('Choose an installed Cantonese voice or choose automatically', '選擇已安裝廣東話語音或自動選擇'),
      value: cantoneseVoices.find((voice) => voice.voiceURI === narrator.settings.cantoneseVoiceURI)?.name ?? t('Choose automatically', '自動選擇'),
      selector: '#narrator-cantonese-voice-automatic',
      control: cantoneseVoiceGap
        ? { kind: 'none', reason: cantoneseVoiceGap }
        : {
            kind: 'choice',
            value: voiceValue(narrator.settings.cantoneseVoiceURI, cantoneseVoices),
            choices: voiceChoices(cantoneseVoices),
            apply: (value) => narrator.updateSettings({ cantoneseVoiceURI: value }),
          },
      unavailable: cantoneseVoiceGap || undefined,
    },
    {
      id: 'rate',
      section: 'narrator',
      label: t('Rate', '速度'),
      description: t('Adjust speaking speed', '調整朗讀速度'),
      value: String(narrator.settings.rate),
      selector: '.narrator-tuning input[min="0.1"]',
      control: { kind: 'range', value: narrator.settings.rate, min: 0.1, max: 10, step: 0.1, apply: (value) => narrator.updateSettings({ rate: value }) },
      unavailable: narration || undefined,
    },
    {
      id: 'pitch',
      section: 'narrator',
      label: t('Pitch', '音調'),
      description: t('Adjust the voice pitch', '調整語音音調'),
      value: String(narrator.settings.pitch),
      selector: '.narrator-tuning input[min="0"]',
      control: { kind: 'range', value: narrator.settings.pitch, min: 0, max: 2, step: 0.1, apply: (value) => narrator.updateSettings({ pitch: value }) },
      unavailable: narration || undefined,
    },
    {
      id: 'quiet',
      section: 'narrator',
      label: t('Quiet narration', '靜音旁白'),
      description: t('Silence narration while another voice is active', '其他語音使用時令旁白靜音'),
      value: narrator.settings.quiet ? t('On', '開') : t('Off', '關'),
      selector: '#narrator-quiet',
      control: { kind: 'switch', value: narrator.settings.quiet, apply: (value) => narrator.updateSettings({ quiet: value }) },
      unavailable: narration || undefined,
    },
    {
      id: 'preview',
      section: 'narrator',
      label: t('Preview narration', '試聽旁白'),
      description: t('Hear a sample with the selected voice settings', '試聽所選語音設定'),
      selector: '.narrator-advanced > button',
      control: {
        kind: 'none',
        reason: t(
          'A preview is spoken by the narrator surface, which resolves the voice it will actually use.',
          '試聽由旁白設定頁播放，該頁會決定實際使用嘅語音。',
        ),
      },
      unavailable: narration || undefined,
    },
    {
      id: 'local-data',
      section: 'privacy',
      label: t('Your journey stays yours', '你嘅行程，由你掌握'),
      description: t('Saved trips, local storage and routing requests', '儲存行程、本機資料及路線請求'),
      selector: '#settings-local-data',
      control: { kind: 'none', reason: t('This explains what the planner keeps. There is nothing to change.', '呢段講解規劃工具保留咩，冇嘢需要更改。') },
    },
    {
      id: 'shared-links',
      section: 'privacy',
      label: t('Sharing a trip', '分享行程'),
      description: t('Shared links contain the journey locations', '分享連結包含行程地點'),
      selector: '#settings-sharing',
      control: { kind: 'none', reason: t('This explains what a shared link carries. There is nothing to change.', '呢段講解分享連結包含咩，冇嘢需要更改。') },
    },
    {
      id: 'reliability',
      section: 'privacy',
      label: t('Data and reliability', '資料及可靠程度'),
      description: t('Independent planner and official service notices', '獨立規劃工具及官方服務通告'),
      selector: '#settings-reliability',
      control: { kind: 'none', reason: t('This explains where the answers come from. There is nothing to change.', '呢段講解答案嘅來源，冇嘢需要更改。') },
    },
  ];
  /* Removed from the catalog, which is what removes them from both readers at
     once. A row left here and hidden only in the workspace is a control the
     palette can still teleport straight to. */
  if (input.appearance) {
    const appearance = input.appearance;
    entries.push(
      { id: 'appearance-name', section: 'appearance', label: t('Display name', '顯示名稱'), description: t('Rename this browser workspace', '為此瀏覽器工作區改名'), selector: '#appearance-app-name', value: appearance.global.appName ?? '', control: { kind: 'text', value: appearance.global.appName ?? '', maxLength: 40, apply: value => appearance.set({ appName: value || null }) } },
      { id: 'appearance-size', section: 'appearance', label: t('Text size', '文字大小'), description: t('Scale interface text', '縮放介面文字'), selector: '#appearance-size', value: `${Math.round(appearance.global.sizeScale * 100)}%`, control: { kind: 'range', min: .8, max: 1.5, step: .05, value: appearance.global.sizeScale, apply: value => appearance.set({ sizeScale: value }) } },
      { id: 'appearance-density', section: 'appearance', label: t('Interface density', '介面密度'), description: t('Compact, default or comfortable spacing', '緊密、預設或寬鬆間距'), selector: '#appearance-density', value: appearance.global.density, control: { kind: 'choice', value: appearance.global.density, choices: ['compact','default','comfortable'].map((value,index) => ({ value, label: t(['Compact','Default','Comfortable'][index],['緊密','預設','寬鬆'][index]) })), apply: value => appearance.set({ density: value }) } },
      { id: 'appearance-emoji', section: 'appearance', label: t('Decorative emoji', '裝飾表情符號'), description: t('Show decorative emoji in interface wording', '顯示介面文字內嘅裝飾表情符號'), selector: '#appearance-emoji', control: { kind: 'switch', value: appearance.global.showEmoji, apply: value => appearance.set({ showEmoji: value }) } },
      ...[['appearance-colour','Seed colours and colour formats','基礎顏色同色彩格式','#appearance-colours'],['appearance-elements','Element states and layers','元素狀態同圖層','#appearance-elements'],['appearance-presets','Appearance presets and import/export','外觀預設同匯入匯出','#appearance-presets']].map(([id,en,zh,selector]) => ({ id,section:'appearance' as const,label:t(en,zh),description:t('Open the complete editor and its preview','開啟完整編輯器同預覽'),selector,control:{kind:'none' as const,reason:t('Use the full editor for its preview and validation.','請使用完整編輯器查看預覽同驗證。')}})),
    );
    if (appearance.ready === false) for (const entry of entries) if (entry.id.startsWith('appearance-')) entry.unavailable = t('Appearance settings are still loading.', '外觀設定仍在載入中。');
  }
  return hidden ? entries.filter((entry) => !HIDDEN_BY_SCHOOL.includes(entry.id)) : entries;
}
