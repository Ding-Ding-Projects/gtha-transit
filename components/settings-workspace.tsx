'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Accessibility, ArrowRight, Check, Languages, Mic2, Moon, Palette, Search, ShieldCheck, Sun, RotateCcw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import NarratorSettings from './narrator-settings';
import AppearanceEditor from './appearance-editor';
import type { AppearanceController } from '../lib/appearance/use-appearance';
import ComfortSettings from './comfort-settings';
import SchoolMode from './school-mode';
import { schoolName, type SchoolState } from '../lib/school-mode';
import type { NarratorController } from '../lib/narrator';
import { useLocalSetting } from '../lib/use-local-setting';
import { SETTINGS_SECTION_KEY, SETTINGS_SECTIONS, settingsCatalog, type SettingsEntry, type SettingsSection } from '../lib/settings-catalog';
import { toggleMode, type AdhdMode, type AdhdState } from '../lib/adhd-modes';
import { entryCount, type VocabularyFile } from '../lib/personal-vocabulary';

type Lang = 'en' | 'zh' | 'both';
type Section = SettingsSection;
type Translate = (en: string, zh: string) => string;
/**
 * The settings list is no longer written here.
 *
 * It comes from the shared catalog, which the command palette reads too. A
 * setting added to one surface and forgotten in the other is a setting the
 * palette cannot find, and nothing about that failure announces itself.
 */
type SearchEntry = SettingsEntry;

function SettingsSearch({ entries, storageId, title, t, navigate }: { entries: SearchEntry[]; storageId: string; title: string; t: Translate; navigate: (entry: SearchEntry) => void }) {
  const [search, setSearch] = useState(emptySearchState);
  const samples = useMemo(() => entries.map(entry => [entry.id, entry.section, entry.label, entry.description, entry.value].filter(Boolean).join(' ')), [entries]);
  const result = useSearchMatches(samples, search);
  const hasQuery = (search.mode === 'regex' ? search.pattern : search.query).trim().length > 0;
  return <details className="settings-find">
    <summary><Search size={16} aria-hidden="true" /><span>{title}</span></summary>
    <SearchWorkbench storageId={storageId} label={title} value={search} onChange={setSearch} samples={samples} t={t} />
    {hasQuery && <div className="settings-search-results" aria-label={t('Matching settings', '符合嘅設定')}>
      {result.error ? <output>{t('This expression could not be evaluated. Edit the expression or choose plain text.', '未能配對此規則，請修改或選擇純文字。')}</output> : result.busy ? <output>{t('Finding settings…', '搜尋設定中…')}</output> : entries.filter((_, index) => result.matches[index]).length === 0 ? <output>{t('No matching settings. Try language, theme, voice or privacy.', '未有符合嘅設定，試下語言、主題、語音或私隱。')}</output> : entries.map((entry, index) => result.matches[index] && <button data-ui="settings.action" key={entry.id} type="button" onClick={() => navigate(entry)}><span><strong>{entry.label}</strong><small>{entry.description}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
    </div>}
  </details>;
}

const englishPreviews = ['Clear directions, at your pace.', 'Plan a straightforward journey.', 'A smoother route to your next stop.', 'Find your route and let the region connect.', 'Your next connection. Minus the timetable gymnastics.'];
const cantonesePreviews = ['按需要規劃行程。', '清晰規劃每一程。', '下一站，輕鬆到達。', '搵好路線，出門就放心啲。', '轉車可以，轉到頭暈就唔使喇。'];

export default function SettingsWorkspace({ appearance, lang, setLang, dark, setDark, funEn, setFunEn, funZh, setFunZh, narrator, t, adhd, setAdhd, vocabulary, setVocabulary, school, setSchool }: {
  appearance: AppearanceController;
  lang: Lang; setLang: (value: Lang) => void;
  dark: boolean; setDark: (value: boolean) => void;
  funEn: number; setFunEn: (value: number) => void;
  funZh: number; setFunZh: (value: number) => void;
  narrator: NarratorController; t: Translate;
  adhd: AdhdState; setAdhd: (next: AdhdState | ((current: AdhdState) => AdhdState)) => void;
  vocabulary: VocabularyFile | null; setVocabulary: (next: VocabularyFile | null) => void;
  school: SchoolState; setSchool: (next: SchoolState) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(':', '');
  const storedTab = useLocalSetting(SETTINGS_SECTION_KEY);
  const stored = (SETTINGS_SECTIONS as readonly string[]).includes(storedTab.value || '') ? storedTab.value as Section : 'appearance';
  /* Somebody who was on the Language tab when the mode came on lands on Appearance
     rather than on a tab that no longer exists. Their stored choice is untouched
     and returns with the tab. */
  const active: Section = school.on && stored === 'language' ? 'appearance' : stored;
  /* The whole Language tab goes while School mode is on, rather than staying as
     an empty or greyed one. A tab labelled "Language" with nothing in it still
     announces what was taken away. */
  const sections = [
    { id: 'appearance', label: t('Appearance', '外觀'), icon: Palette },
    ...(school.on ? [] : [{ id: 'language', label: t('Language', '語言'), icon: Languages }]),
    { id: 'comfort', label: t('Comfort', '舒適'), icon: Accessibility },
    { id: 'narrator', label: t('Narrator', '旁白'), icon: Mic2 },
    { id: 'privacy', label: t('Privacy', '私隱'), icon: ShieldCheck },
  ];
  const entries = settingsCatalog({ appearance: { ready: appearance.ready, global: appearance.global, set: patch => appearance.update({ global: { ...appearance.global, ...patch } }) }, t, lang, setLang: value => setLang(value as Lang), dark, setDark, funEn, setFunEn, funZh, setFunZh, narrator,
    school: { on: school.on, name: schoolName(school) },
    comfort: { modes: adhd.modes, toggleMode: mode => setAdhd(current => toggleMode(current, mode as AdhdMode)), vocabularyEntries: entryCount(vocabulary) } });
  const [navigationTarget, setNavigationTarget] = useState<SearchEntry | null>(null);
  const previewVoiceAvailable = narrator.settings.language === 'en' ? !!narrator.englishVoice.voice : narrator.settings.language === 'zh' ? !!narrator.cantoneseVoice.voice : !!(narrator.englishVoice.voice || narrator.cantoneseVoice.voice);
  const navigationNotice = !navigationTarget ? '' : !narrator.speechAvailable ? t('This browser does not provide speech synthesis. Voice controls are unavailable here.', '此瀏覽器未提供語音合成，未能使用語音控制。') : !narrator.settings.enabled ? t('Enable narration first to change this voice setting.', '請先開啟旁白，再更改此語音設定。') : navigationTarget.id === 'preview' && narrator.settings.quiet ? t('Turn off quiet narration to hear a preview.', '請關閉靜音旁白以試聽。') : navigationTarget.id === 'preview' && !previewVoiceAvailable ? t('No compatible voice is available for the chosen narration language.', '所選旁白語言未有可用語音。') : '';
  const navigate = (entry: SearchEntry) => {
    storedTab.setValue(entry.section);
    requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(entry.selector);
      if (!target) return;
      let ancestor = target.parentElement;
      while (ancestor && ancestor !== root.current) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
      const disabled = target.matches(':disabled');
      const focusTarget = disabled ? target.closest<HTMLElement>('fieldset') || target.closest<HTMLElement>('.narrator-card') : target;
      if (focusTarget) { if (!focusTarget.hasAttribute('tabindex') && disabled) focusTarget.tabIndex = -1; focusTarget.scrollIntoView({ block: 'center', behavior: 'instant' }); focusTarget.focus({ preventScroll: true }); }
      setNavigationTarget(disabled ? entry : null);
    });
  };
  const findIn = (section: Section) => <SettingsSearch entries={entries.filter(entry => entry.section === section)} storageId={'settings-' + section + '-search'} title={t('Find in this section', '搜尋此部分')} t={t} navigate={navigate} />;
  return <div className="page-panel settings settings-workspace" data-ui="settings.workspace" ref={root}>
    <h2 className="sr-only">{t('Settings & privacy', '設定及私隱')}</h2>
    <SettingsSearch entries={entries} storageId="settings-all-search" title={t('Find any setting', '搜尋所有設定')} t={t} navigate={navigate} />
    {storedTab.unavailable && <output className="settings-notice">{t('Your selected section could not be saved. The controls still work in this session.', '未能儲存所選部分，此次使用仍可操作。')}</output>}
    {navigationNotice && <output className="settings-notice">{navigationNotice}</output>}
    <Tabs value={active} onValueChange={value => { storedTab.setValue(String(value)); setNavigationTarget(null); }} className="settings-tabs">
      <TabsList aria-label={t('Settings sections', '設定部分')} className="settings-tab-strip">
        {sections.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id}><Icon size={18} aria-hidden="true" /><span>{label}</span></TabsTrigger>)}
      </TabsList>
      <TabsContent value="appearance" className="settings-section" keepMounted>
        {findIn('appearance')}
        <AppearanceEditor controller={appearance} t={t} />
        <section data-ui="settings.card" className="preference-card" aria-labelledby={id + '-appearance'}>
          <div className="preference-card-heading"><Palette size={23} aria-hidden="true" /><div><h3 id={id + '-appearance'}>{t('Colour theme', '色彩主題')}</h3><p>{t('Choose the light that feels right.', '揀一個睇得舒服嘅明暗。')}</p></div></div>
          <fieldset className="appearance-choices"><legend className="sr-only">{t('Colour theme', '色彩主題')}</legend>
            {[{ value: false, label: t('Light', '淺色'), description: t('Bright surfaces and crisp detail', '明亮介面，細節清楚'), icon: Sun }, { value: true, label: t('Dark', '深色'), description: t('Dim surfaces for quieter viewing', '暗色介面，睇得柔和'), icon: Moon }].map(({ value, label, description, icon: Icon }) => <label className={'appearance-choice ' + (value ? 'choice-dark' : 'choice-light')} key={String(value)}><input data-ui="settings.field" id={'settings-theme-' + (value ? 'dark' : 'light')} type="radio" name={id + '-theme'} checked={dark === value} onChange={() => setDark(value)} /><Icon size={28} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>{dark === value && <Check size={18} aria-hidden="true" />}</label>)}
          </fieldset>
          <p className="settings-default">{t('Default: Light. Changes apply immediately throughout the planner.', '預設：淺色。變更會即時套用到整個規劃工具。')}</p>
        </section>
      </TabsContent>
      {!school.on && <TabsContent value="language" className="settings-section" keepMounted>
        {findIn('language')}
        <section data-ui="settings.card" className="preference-card" aria-labelledby={id + '-language'}>
          <div className="preference-card-heading"><Languages size={23} aria-hidden="true" /><div><h3 id={id + '-language'}>{t('Language', '語言')}</h3><p>{t('Use one language or see both together.', '用一種語言，或者同時睇兩種。')}</p></div></div>
          <fieldset className="language-choices"><legend className="sr-only">{t('Language mode', '語言模式')}</legend>
            {[{ value: 'en', name: 'English', detail: t('English throughout the planner', '整個規劃工具使用英文') }, { value: 'zh', name: '香港廣東話', detail: t('Hong Kong Cantonese', '香港廣東話') }, { value: 'both', name: 'English + 廣東話', detail: t('Both languages together', '同時顯示兩種語言') }].map(({ value, name, detail }) => <label key={value}><input data-ui="settings.field" id={'settings-language-' + value} type="radio" name={id + '-language'} checked={lang === value} onChange={() => setLang(value as Lang)} /><span><strong>{name}</strong><small>{detail}</small></span>{lang === value && <Check size={18} aria-hidden="true" />}</label>)}
          </fieldset>
          <p className="settings-default">{t('Default: English. Narration has its own language choice.', '預設：英文。旁白有獨立語言選擇。')}</p>
        </section>
        <div className="tone-cards">
          {[{ key: 'english', label: t('English playfulness', '英文趣味程度'), value: funEn, update: setFunEn, preview: englishPreviews, language: 'en' }, { key: 'cantonese', label: t('Cantonese playfulness', '廣東話趣味程度'), value: funZh, update: setFunZh, preview: cantonesePreviews, language: 'zh-Hant' }].map(item => <section data-ui="settings.card" key={item.key} className="preference-card tone-card"><header><label htmlFor={'settings-' + item.key + '-tone'}>{item.label}</label><output htmlFor={'settings-' + item.key + '-tone'}>{item.value}<small>/5</small></output></header><input data-ui="settings.field" id={'settings-' + item.key + '-tone'} type="range" min="1" max="5" step="1" value={item.value} onChange={event => item.update(Number(event.target.value))} /><div className="tone-scale"><span>{t('Serious', '認真')}</span><span>{t('Playful', '有趣')}</span></div><blockquote lang={item.language}>{item.preview[Math.max(0, Math.min(4, Math.floor(item.value) - 1))]}</blockquote><button data-ui="settings.action" type="button" className="settings-reset" onClick={() => item.update(5)}><RotateCcw size={14} aria-hidden="true" />{t('Reset to 5', '重設為 5')}</button></section>)}
        </div>
        <p className="settings-default">{t('English and Cantonese each default to level 5. Tone changes wording, including warnings and errors, without changing route facts.', '英文同廣東話預設各為第 5 級。語氣會改變包括警告同錯誤嘅用詞，但唔會改變路線事實。')}</p>
      </TabsContent>}
      <TabsContent value="comfort" className="settings-section" keepMounted>
        {findIn('comfort')}
        <ComfortSettings t={t} adhd={adhd} setAdhd={setAdhd} vocabulary={vocabulary} setVocabulary={setVocabulary} hideVocabulary={school.on} />
        {/* Always here, whatever it is hiding: it is the only way back out. */}
        <SchoolMode t={t} state={school} setState={setSchool} />
      </TabsContent>
      <TabsContent value="narrator" className="settings-section" keepMounted>
        {findIn('narrator')}
        <NarratorSettings narrator={narrator} t={t} />
      </TabsContent>
      <TabsContent value="privacy" className="settings-section" keepMounted>
        {findIn('privacy')}
        <section data-ui="settings.card" id="settings-local-data" tabIndex={-1} className="preference-card privacy-card"><ShieldCheck size={24} aria-hidden="true" /><h3>{t('Your journey stays yours', '你嘅行程，由你掌握')}</h3><p>{t('No account. No advertising. No analytics. Saved trips and preferences stay in this browser. Journey searches are sent to our routing service to calculate a route; precise locations are not retained in request logs.', '毋須帳戶，無廣告，無追蹤分析。已儲存行程同設定只留喺呢個瀏覽器。搜尋會傳送到路線服務計算行程，請求記錄唔會保留精確位置。')}</p></section>
        <section data-ui="settings.card" id="settings-sharing" tabIndex={-1} className="preference-card privacy-card"><h3>{t('Sharing a trip', '分享行程')}</h3><p>{t('Sharing a trip creates a link containing the journey locations. Only share locations you are comfortable disclosing. Clearing browser storage removes saved trips and settings.', '分享行程嘅連結包含行程地點，只分享你願意公開嘅位置。清除瀏覽器儲存資料會移除行程同設定。')}</p></section>
        <section data-ui="settings.card" id="settings-reliability" tabIndex={-1} className="preference-card privacy-card"><h3>{t('Data and reliability', '資料及可靠程度')}</h3><p>{t('This is an independent planner. Always allow time for transfers and check official notices before travelling.', '呢個係獨立規劃工具。請預留轉車時間，出發前查閱官方通告。')}</p></section>
      </TabsContent>
    </Tabs>
  </div>;
}
