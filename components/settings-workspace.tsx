'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Languages, Mic2, Moon, Palette, Search, ShieldCheck, Sun, RotateCcw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { SearchWorkbench, emptySearchState, useSearchMatches } from './search-workbench';
import NarratorSettings from './narrator-settings';
import type { NarratorController } from '../lib/narrator';
import { useLocalSetting } from '../lib/use-local-setting';

type Lang = 'en' | 'zh' | 'both';
type Section = 'appearance' | 'language' | 'narrator' | 'privacy';
type Translate = (en: string, zh: string) => string;
type SearchEntry = { id: string; section: Section; label: string; description: string; value?: string; selector: string };

function SettingsSearch({ entries, storageId, title, t, navigate }: { entries: SearchEntry[]; storageId: string; title: string; t: Translate; navigate: (entry: SearchEntry) => void }) {
  const [search, setSearch] = useState(emptySearchState);
  const samples = useMemo(() => entries.map(entry => [entry.id, entry.section, entry.label, entry.description, entry.value].filter(Boolean).join(' ')), [entries]);
  const result = useSearchMatches(samples, search);
  const hasQuery = (search.mode === 'regex' ? search.pattern : search.query).trim().length > 0;
  return <details className="settings-find">
    <summary><Search size={16} aria-hidden="true" /><span>{title}</span></summary>
    <SearchWorkbench storageId={storageId} label={title} value={search} onChange={setSearch} samples={samples} t={t} />
    {hasQuery && <div className="settings-search-results" aria-label={t('Matching settings', '符合嘅設定')}>
      {result.error ? <output>{t('This expression could not be evaluated. Edit the expression or choose plain text.', '未能配對此規則，請修改或選擇純文字。')}</output> : result.busy ? <output>{t('Finding settings…', '搜尋設定中…')}</output> : entries.filter((_, index) => result.matches[index]).length === 0 ? <output>{t('No matching settings. Try language, theme, voice or privacy.', '未有符合嘅設定，試下語言、主題、語音或私隱。')}</output> : entries.map((entry, index) => result.matches[index] && <button key={entry.id} type="button" onClick={() => navigate(entry)}><span><strong>{entry.label}</strong><small>{entry.description}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
    </div>}
  </details>;
}

const englishPreviews = ['Clear directions, at your pace.', 'Plan a straightforward journey.', 'A smoother route to your next stop.', 'Find your route and let the region connect.', 'Your next connection. Minus the timetable gymnastics.'];
const cantonesePreviews = ['按需要規劃行程。', '清晰規劃每一程。', '下一站，輕鬆到達。', '搵好路線，出門就放心啲。', '轉車可以，轉到頭暈就唔使喇。'];

export default function SettingsWorkspace({ lang, setLang, dark, setDark, funEn, setFunEn, funZh, setFunZh, narrator, t }: {
  lang: Lang; setLang: (value: Lang) => void;
  dark: boolean; setDark: (value: boolean) => void;
  funEn: number; setFunEn: (value: number) => void;
  funZh: number; setFunZh: (value: number) => void;
  narrator: NarratorController; t: Translate;
}) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(':', '');
  const storedTab = useLocalSetting('gtha-settings-section-v1');
  const active: Section = ['appearance', 'language', 'narrator', 'privacy'].includes(storedTab.value || '') ? storedTab.value as Section : 'appearance';
  const sections = [
    { id: 'appearance', label: t('Appearance', '外觀'), icon: Palette },
    { id: 'language', label: t('Language', '語言'), icon: Languages },
    { id: 'narrator', label: t('Narrator', '旁白'), icon: Mic2 },
    { id: 'privacy', label: t('Privacy', '私隱'), icon: ShieldCheck },
  ];
  const entries: SearchEntry[] = [
    { id: 'theme', section: 'appearance', label: t('Colour theme', '色彩主題'), description: t('Light or dark appearance', '淺色或深色外觀'), value: dark ? t('Dark', '深色') : t('Light', '淺色'), selector: '#settings-theme-light' },
    { id: 'language', section: 'language', label: t('Language', '語言'), description: t('English, Hong Kong Cantonese or both', '英文、香港廣東話或雙語'), value: lang, selector: '#settings-language-en' },
    { id: 'english-tone', section: 'language', label: t('English playfulness', '英文趣味程度'), description: t('Independent English tone from serious to playful', '獨立英文語氣，由認真至有趣'), value: String(funEn), selector: '#settings-english-tone' },
    { id: 'cantonese-tone', section: 'language', label: t('Cantonese playfulness', '廣東話趣味程度'), description: t('Independent Cantonese tone from serious to playful', '獨立廣東話語氣，由認真至有趣'), value: String(funZh), selector: '#settings-cantonese-tone' },
    { id: 'narration', section: 'narrator', label: t('Enable narration', '開啟旁白'), description: t('Spoken journey updates, off by default', '語音行程提示，預設關閉'), selector: '#narrator-enabled' },
    { id: 'narration-language', section: 'narrator', label: t('Narration language', '旁白語言'), description: t('English, Cantonese or both in sequence', '英文、廣東話或依次讀出兩者'), selector: '#narrator-language-en' },
    { id: 'english-voice', section: 'narrator', label: t('English voice', '英文語音'), description: t('Choose an installed voice or choose automatically', '選擇已安裝語音或自動選擇'), selector: '#narrator-english-voice-automatic' },
    { id: 'cantonese-voice', section: 'narrator', label: t('Hong Kong Cantonese voice', '香港廣東話語音'), description: t('Choose an installed Cantonese voice or choose automatically', '選擇已安裝廣東話語音或自動選擇'), selector: '#narrator-cantonese-voice-automatic' },
    { id: 'rate', section: 'narrator', label: t('Rate', '速度'), description: t('Adjust speaking speed', '調整朗讀速度'), value: String(narrator.settings.rate), selector: '.narrator-tuning input[min="0.1"]' },
    { id: 'pitch', section: 'narrator', label: t('Pitch', '音調'), description: t('Adjust the voice pitch', '調整語音音調'), value: String(narrator.settings.pitch), selector: '.narrator-tuning input[min="0"]' },
    { id: 'quiet', section: 'narrator', label: t('Quiet narration', '靜音旁白'), description: t('Silence narration while another voice is active', '其他語音使用時令旁白靜音'), selector: '#narrator-quiet' },
    { id: 'preview', section: 'narrator', label: t('Preview narration', '試聽旁白'), description: t('Hear a sample with the selected voice settings', '試聽所選語音設定'), selector: '.narrator-advanced > button' },
    { id: 'local-data', section: 'privacy', label: t('Your journey stays yours', '你嘅行程，由你掌握'), description: t('Saved trips, local storage and routing requests', '儲存行程、本機資料及路線請求'), selector: '#settings-local-data' },
    { id: 'shared-links', section: 'privacy', label: t('Sharing a trip', '分享行程'), description: t('Shared links contain the journey locations', '分享連結包含行程地點'), selector: '#settings-sharing' },
    { id: 'reliability', section: 'privacy', label: t('Data and reliability', '資料及可靠程度'), description: t('Independent planner and official service notices', '獨立規劃工具及官方服務通告'), selector: '#settings-reliability' },
  ];
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
  return <div className="page-panel settings settings-workspace" ref={root}>
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
        <section className="preference-card" aria-labelledby={id + '-appearance'}>
          <div className="preference-card-heading"><Palette size={23} aria-hidden="true" /><div><h3 id={id + '-appearance'}>{t('Colour theme', '色彩主題')}</h3><p>{t('Choose the light that feels right.', '揀一個睇得舒服嘅明暗。')}</p></div></div>
          <fieldset className="appearance-choices"><legend className="sr-only">{t('Colour theme', '色彩主題')}</legend>
            {[{ value: false, label: t('Light', '淺色'), description: t('Bright surfaces and crisp detail', '明亮介面，細節清楚'), icon: Sun }, { value: true, label: t('Dark', '深色'), description: t('Dim surfaces for quieter viewing', '暗色介面，睇得柔和'), icon: Moon }].map(({ value, label, description, icon: Icon }) => <label className={'appearance-choice ' + (value ? 'choice-dark' : 'choice-light')} key={String(value)}><input id={'settings-theme-' + (value ? 'dark' : 'light')} type="radio" name={id + '-theme'} checked={dark === value} onChange={() => setDark(value)} /><Icon size={28} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>{dark === value && <Check size={18} aria-hidden="true" />}</label>)}
          </fieldset>
          <p className="settings-default">{t('Default: Light. Changes apply immediately throughout the planner.', '預設：淺色。變更會即時套用到整個規劃工具。')}</p>
        </section>
      </TabsContent>
      <TabsContent value="language" className="settings-section" keepMounted>
        {findIn('language')}
        <section className="preference-card" aria-labelledby={id + '-language'}>
          <div className="preference-card-heading"><Languages size={23} aria-hidden="true" /><div><h3 id={id + '-language'}>{t('Language', '語言')}</h3><p>{t('Use one language or see both together.', '用一種語言，或者同時睇兩種。')}</p></div></div>
          <fieldset className="language-choices"><legend className="sr-only">{t('Language mode', '語言模式')}</legend>
            {[{ value: 'en', name: 'English', detail: t('English throughout the planner', '整個規劃工具使用英文') }, { value: 'zh', name: '香港廣東話', detail: t('Hong Kong Cantonese', '香港廣東話') }, { value: 'both', name: 'English + 廣東話', detail: t('Both languages together', '同時顯示兩種語言') }].map(({ value, name, detail }) => <label key={value}><input id={'settings-language-' + value} type="radio" name={id + '-language'} checked={lang === value} onChange={() => setLang(value as Lang)} /><span><strong>{name}</strong><small>{detail}</small></span>{lang === value && <Check size={18} aria-hidden="true" />}</label>)}
          </fieldset>
          <p className="settings-default">{t('Default: English. Narration has its own language choice.', '預設：英文。旁白有獨立語言選擇。')}</p>
        </section>
        <div className="tone-cards">
          {[{ key: 'english', label: t('English playfulness', '英文趣味程度'), value: funEn, update: setFunEn, preview: englishPreviews, language: 'en' }, { key: 'cantonese', label: t('Cantonese playfulness', '廣東話趣味程度'), value: funZh, update: setFunZh, preview: cantonesePreviews, language: 'zh-Hant' }].map(item => <section key={item.key} className="preference-card tone-card"><header><label htmlFor={'settings-' + item.key + '-tone'}>{item.label}</label><output htmlFor={'settings-' + item.key + '-tone'}>{item.value}<small>/5</small></output></header><input id={'settings-' + item.key + '-tone'} type="range" min="1" max="5" step="1" value={item.value} onChange={event => item.update(Number(event.target.value))} /><div className="tone-scale"><span>{t('Serious', '認真')}</span><span>{t('Playful', '有趣')}</span></div><blockquote lang={item.language}>{item.preview[Math.max(0, Math.min(4, Math.floor(item.value) - 1))]}</blockquote><button type="button" className="settings-reset" onClick={() => item.update(5)}><RotateCcw size={14} aria-hidden="true" />{t('Reset to 5', '重設為 5')}</button></section>)}
        </div>
        <p className="settings-default">{t('English and Cantonese each default to level 5. Tone changes wording, including warnings and errors, without changing route facts.', '英文同廣東話預設各為第 5 級。語氣會改變包括警告同錯誤嘅用詞，但唔會改變路線事實。')}</p>
      </TabsContent>
      <TabsContent value="narrator" className="settings-section" keepMounted>
        {findIn('narrator')}
        <NarratorSettings narrator={narrator} t={t} />
      </TabsContent>
      <TabsContent value="privacy" className="settings-section" keepMounted>
        {findIn('privacy')}
        <section id="settings-local-data" tabIndex={-1} className="preference-card privacy-card"><ShieldCheck size={24} aria-hidden="true" /><h3>{t('Your journey stays yours', '你嘅行程，由你掌握')}</h3><p>{t('No account. No advertising. No analytics. Saved trips and preferences stay in this browser. Journey searches are sent to our routing service to calculate a route; precise locations are not retained in request logs.', '毋須帳戶，無廣告，無追蹤分析。已儲存行程同設定只留喺呢個瀏覽器。搜尋會傳送到路線服務計算行程，請求記錄唔會保留精確位置。')}</p></section>
        <section id="settings-sharing" tabIndex={-1} className="preference-card privacy-card"><h3>{t('Sharing a trip', '分享行程')}</h3><p>{t('Sharing a trip creates a link containing the journey locations. Only share locations you are comfortable disclosing. Clearing browser storage removes saved trips and settings.', '分享行程嘅連結包含行程地點，只分享你願意公開嘅位置。清除瀏覽器儲存資料會移除行程同設定。')}</p></section>
        <section id="settings-reliability" tabIndex={-1} className="preference-card privacy-card"><h3>{t('Data and reliability', '資料及可靠程度')}</h3><p>{t('This is an independent planner. Always allow time for transfers and check official notices before travelling.', '呢個係獨立規劃工具。請預留轉車時間，出發前查閱官方通告。')}</p></section>
      </TabsContent>
    </Tabs>
  </div>;
}
