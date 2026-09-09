/**
 * One explanation, and one honest provenance line, for every settings row.
 *
 * `lib/settings-catalog.ts` already carries a label and a short description for
 * each entry, but a description is not the same thing as an explanation: the
 * catalog's `description` is a scannable sub-line ("Light or dark appearance"),
 * and the guided-forms rule elsewhere in this project asks for the fuller
 * "what does this actually do" text behind progressive disclosure, plus a
 * separate line saying whether the value on screen is something you saved or
 * the value the planner ships with. This file is that second layer.
 *
 * The id list here is hand-written against `lib/settings-catalog.ts` rather
 * than computed from it, on purpose: a completeness test that only checks the
 * rows present are well-formed would pass on a settings row with no
 * explanation at all, because it never looked for one. `tests/settings-
 * explanations.test.mjs` builds the real catalog with every optional input
 * supplied and asserts the two id sets are exactly equal, in both directions --
 * so a settings row added without an explanation, or an explanation left
 * behind for a row that no longer exists, both fail the build.
 */

export type ExplainedSetting = {
  id: string;
  /** What the setting does, in English. Not a restatement of its label. */
  en: string;
  /** The same explanation in Hong Kong Cantonese. */
  zh: string;
  /** The real shipped value, in words -- never the opaque word "default". */
  shipped: string;
};

export type Translate = (en: string, zh: string) => string;

const NOT_APPLICABLE = 'Not applicable — this row is informational only';

export const EXPLAINED_SETTINGS: readonly ExplainedSetting[] = Object.freeze([
  {
    id: 'theme',
    en: 'Switches the whole planner between a light and a dark colour scheme.',
    zh: '喺成個規劃工具嘅淺色同深色主題之間切換。',
    shipped: 'Light',
  },
  {
    id: 'language',
    en: 'Chooses whether the interface reads in English, Hong Kong Cantonese, or both languages together.',
    zh: '揀介面用英文、香港廣東話,定係兩種語言一齊顯示。',
    shipped: 'English',
  },
  {
    id: 'english-tone',
    en: 'Sets how playful the English wording is, from fully professional to maximum playfulness, independently of the Cantonese tone.',
    zh: '獨立調整英文用詞嘅趣味程度,由認真到最玩味,唔會影響廣東話語氣。',
    shipped: '5',
  },
  {
    id: 'cantonese-tone',
    en: 'Sets how playful the Cantonese wording is, from fully professional to maximum playfulness, independently of the English tone.',
    zh: '獨立調整廣東話用詞嘅趣味程度,由認真到最玩味,唔會影響英文語氣。',
    shipped: '5',
  },
  {
    id: 'school-mode',
    en: 'Puts the planner into plain English only, hiding Cantonese, bilingual mode, both playfulness sliders, personal vocabulary and the dim sum surprise until it is turned off again.',
    zh: '將規劃工具轉做純英文,收埋廣東話、雙語模式、兩個趣味滑桿、個人用語同埋點心驚喜,直至再次關閉為止。',
    shipped: 'Off',
  },
  {
    id: 'comfort-focus',
    en: 'Brings whatever you are currently working on forward and pushes the rest of the interface back.',
    zh: '將你手頭做緊嘅嘢突出嚟,其餘介面淡化落去。',
    shipped: 'Off',
  },
  {
    id: 'comfort-low-stimulation',
    en: 'Reduces motion, calms down colour and cuts back notifications for a quieter interface.',
    zh: '減少郁動、令色彩柔和啲,並減少通知,令介面靜啲。',
    shipped: 'Off',
  },
  {
    id: 'comfort-time-awareness',
    en: 'Shows how long this session has been open and how long since anything last changed.',
    zh: '顯示呢個工作階段開咗幾耐,同埋上次有嘢改動之後過咗幾耐。',
    shipped: 'Off',
  },
  {
    id: 'comfort-one-thing',
    en: 'Keeps a single next action visible at a time, chosen by you.',
    zh: '一次淨係顯示一個由你揀嘅下一步行動。',
    shipped: 'Off',
  },
  {
    id: 'comfort-momentum',
    en: 'Shows a quiet, dismissible reminder when something has been left untouched for a while.',
    zh: '當有嘢擺低咗好耐冇郁過,就靜靜哋提你一句,可以隨時收埋。',
    shipped: 'Off',
  },
  {
    id: 'personal-vocabulary',
    en: 'Loads a local JSON file of your own wording, so the planner uses your words in place of its shipped copy.',
    zh: '載入你自己嘅本機 JSON 用語檔案,規劃工具就會用返你自己嘅字眼,而唔係預設文字。',
    shipped: 'No file loaded',
  },
  {
    id: 'narration',
    en: 'Turns spoken journey updates on or off.',
    zh: '開關語音行程提示。',
    shipped: 'Off',
  },
  {
    id: 'narration-language',
    en: 'Chooses whether narration speaks in English, Cantonese, or both languages one after another.',
    zh: '揀旁白讀英文、廣東話,定係兩種語言依次讀出。',
    shipped: 'English',
  },
  {
    id: 'english-voice',
    en: 'Chooses which installed voice narrates English, or lets the browser choose automatically.',
    zh: '揀邊個已安裝語音讀英文,或者交低瀏覽器自動選擇。',
    shipped: 'Choose automatically',
  },
  {
    id: 'cantonese-voice',
    en: 'Chooses which installed voice narrates Cantonese, or lets the browser choose automatically.',
    zh: '揀邊個已安裝語音讀廣東話,或者交低瀏覽器自動選擇。',
    shipped: 'Choose automatically',
  },
  {
    id: 'rate',
    en: 'Adjusts how fast the narrator speaks.',
    zh: '調整旁白朗讀嘅速度。',
    shipped: '1',
  },
  {
    id: 'pitch',
    en: "Adjusts the narrator's voice pitch.",
    zh: '調整旁白語音嘅音調。',
    shipped: '1',
  },
  {
    id: 'quiet',
    en: 'Silences narration while another voice, such as a screen reader, is already speaking.',
    zh: '當另一把聲(例如讀屏工具)講緊嘢嘅時候,令旁白靜音。',
    shipped: 'Off',
  },
  {
    id: 'preview',
    en: 'Plays a short sample with the currently selected voice settings, so you can hear a change before relying on it.',
    zh: '用目前選定嘅語音設定播放一段試聽,等你喺正式使用之前聽下效果。',
    shipped: NOT_APPLICABLE,
  },
  {
    id: 'local-data',
    en: 'Explains what the planner keeps: saved trips, local storage and routing requests. There is nothing to change here.',
    zh: '講解規劃工具保留咩資料:已儲存行程、本機儲存同路線請求。呢度冇嘢可以更改。',
    shipped: NOT_APPLICABLE,
  },
  {
    id: 'shared-links',
    en: "Explains that a shared link carries the journey's locations. There is nothing to change here.",
    zh: '講解分享連結會包含行程地點。呢度冇嘢可以更改。',
    shipped: NOT_APPLICABLE,
  },
  {
    id: 'reliability',
    en: "Explains where the planner's answers come from: independent planning plus official service notices. There is nothing to change here.",
    zh: '講解規劃工具嘅答案嚟源:獨立規劃資訊,加埋官方服務通告。呢度冇嘢可以更改。',
    shipped: NOT_APPLICABLE,
  },
]);

const explanationMap = new Map(EXPLAINED_SETTINGS.map((row) => [row.id, row]));

export function explanationFor(id: string): ExplainedSetting | null {
  return explanationMap.get(id) ?? null;
}

/**
 * Whether the value on screen is something you saved, or the value the
 * planner ships with. The fallback names the real shipped value rather than
 * the word "default", per this project's own settings-explain-themselves rule.
 */
export function provenanceLine(input: { stored: boolean; shipped: string }, t: Translate): string {
  return input.stored
    ? t('From your saved value', '由你儲存嘅設定')
    : t(`Shipped default: ${input.shipped}`, `預設:${input.shipped}`);
}
