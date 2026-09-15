/**
 * Bilingual chrome copy for the generated documentation site.
 *
 * Every string a visitor sees around the documentation - navigation, search,
 * theme and language controls, the landing page's own headings - lives here as
 * an {en, zh} pair. Article bodies are not translated: like the in-app guides
 * browser, the documentation itself stays English and only the surrounding
 * chrome follows the language setting, including the bilingual mode.
 *
 * This file is plain data plus one small accessor, so `build-site.mjs` and its
 * tests can both read it without pulling in JSX or a bundler.
 */

/** @typedef {{ en: string; zh: string }} Copy */

/** @type {Record<string, Copy>} */
export const SITE_COPY = {
  siteName: { en: 'GTHA Transit', zh: 'GTHA Transit' },
  tagline: { en: 'Your region. Your next connection.', zh: '你嘅地區，你嘅下一程接駁。' },
  skipToContent: { en: 'Skip to content', zh: '跳至內容' },
  navHome: { en: 'Home', zh: '主頁' },
  navDocs: { en: 'Documentation', zh: '文件' },
  openPlanner: { en: 'Open the planner', zh: '開啟規劃工具' },
  viewOnGitHub: { en: 'View source on GitHub', zh: '喺 GitHub 睇原始碼' },
  languageLabel: { en: 'Language', zh: '語言' },
  languageEnglish: { en: 'English', zh: '英文' },
  languageCantonese: { en: 'Cantonese', zh: '廣東話' },
  languageBilingual: { en: 'Bilingual', zh: '雙語' },
  themeToggle: { en: 'Toggle light and dark theme', zh: '切換淺色同深色主題' },
  themeLight: { en: 'Light', zh: '淺色' },
  themeDark: { en: 'Dark', zh: '深色' },
  searchLabel: { en: 'Search the documentation', zh: '搜尋文件' },
  searchPlaceholder: { en: 'Search articles…', zh: '搜尋文章…' },
  regexToggle: { en: 'Use regular expression', zh: '使用正則表達式' },
  regexError: {
    en: 'This expression could not be evaluated. Showing every article.',
    zh: '未能評估呢個表達式，顯示咗全部文章。',
  },
  noResults: { en: 'No article matches. Try a shorter word.', zh: '冇文章符合，試下短啲嘅字。' },
  categoriesHeading: { en: 'Browse by category', zh: '按類別瀏覽' },
  allArticlesHeading: { en: 'Every article', zh: '全部文章' },
  articleSourceNote: { en: 'Guides are written in English.', zh: '文件以英文撰寫。' },
  viewArticleOnGitHub: { en: 'View on GitHub', zh: '喺 GitHub 睇' },
  homeHeroHeading: { en: 'An independent transit planner for the GTHA', zh: '大多倫多及咸美頓地區嘅獨立交通規劃工具' },
  homeHeroBody: {
    en: 'Compare cross-agency schedules, walking connections, live TTC subway and light rail alerts, and vehicle tracking, in one journey planner with no account and no analytics.',
    zh: '一個規劃工具，比較跨機構時間表、步行接駁、TTC 地鐵同輕鐵嘅即時公告，仲有車輛追蹤，唔使註冊，亦冇分析追蹤。',
  },
  homeGalleryHeading: { en: 'What it looks like', zh: '介面長咩樣' },
  homeGalleryBody: {
    en: 'Every picture below is a real capture of the built application, taken by this repository’s own headless evidence tooling. None is a mockup.',
    zh: '以下每一張都係真實建構後應用程式嘅截圖，由呢個儲存庫自己嘅無頭驗證工具拍攝，冇一張係模擬圖。',
  },
  homeFeaturesHeading: { en: 'What the planner does', zh: '規劃工具做啲乜' },
  homeDocsHeading: { en: 'Read the documentation', zh: '閱讀文件' },
  homeDocsBody: {
    en: 'Every feature is documented: behaviour, configuration, failure modes and verification.',
    zh: '每個功能都有文件記錄：行為、設定、失敗情況同驗證方法。',
  },
  versionLabel: { en: 'Version', zh: '版本' },
  commitLabel: { en: 'Commit', zh: '提交' },
  updatedLabel: { en: 'Updated', zh: '更新於' },
  footerBuiltFrom: { en: 'Built from the open source GTHA Transit repository.', zh: '由開放原始碼嘅 GTHA Transit 儲存庫建立。' },
  footerNotAffiliated: {
    en: 'Not affiliated with TTC, Metrolinx, Triplinx or another transit agency.',
    zh: '本站與 TTC、Metrolinx、Triplinx 或其他交通機構冇隸屬關係。',
  },
  articlesCount: { en: 'articles', zh: '篇文章' },
};

/**
 * Renders one chrome string for a language mode. Bilingual mode returns both,
 * joined with a middle dot, matching the compact secondary-label convention
 * the app itself uses for bilingual copy.
 *
 * @param {keyof typeof SITE_COPY} key
 * @param {'en' | 'zh' | 'bilingual'} language
 */
export function chrome(key, language) {
  const pair = SITE_COPY[key];
  if (!pair) throw new Error(`site-copy.mjs: unknown chrome key ${JSON.stringify(key)}`);
  if (language === 'en') return pair.en;
  if (language === 'zh') return pair.zh;
  return pair.en === pair.zh ? pair.en : `${pair.en} · ${pair.zh}`;
}

/** The bilingual category labels the in-app About destination also uses, kept
 * in step by hand: both surfaces read the same 15 categories out of docs/. */
export const CATEGORY_LABELS = {
  interface: { en: 'Interface', zh: '介面' },
  planning: { en: 'Planning', zh: '路線規劃' },
  vehicles: { en: 'Vehicles', zh: '車輛' },
  status: { en: 'Live status', zh: '即時狀況' },
  data: { en: 'Data', zh: '資料' },
  deployment: { en: 'Deployment', zh: '部署' },
  evidence: { en: 'Evidence', zh: '證據' },
  docs: { en: 'Documentation', zh: '文件' },
  race: { en: 'Race', zh: '比賽' },
  accessibility: { en: 'Accessibility', zh: '無障礙' },
  design: { en: 'Design', zh: '設計' },
  release: { en: 'Release', zh: '發佈' },
  unknown: { en: 'Uncategorised', zh: '未分類' },
  overview: { en: 'Overview', zh: '總覽' },
  history: { en: 'History', zh: '歷史' },
  maps: { en: 'Maps', zh: '地圖' },
  realtime: { en: 'Realtime feeds', zh: '即時資料源' },
  search: { en: 'Search', zh: '搜尋' },
  verification: { en: 'Verification', zh: '驗證' },
};

/** @param {string} category @param {'en' | 'zh' | 'bilingual'} language */
export function categoryLabel(category, language) {
  const pair = CATEGORY_LABELS[category];
  if (!pair) return category;
  if (language === 'en') return pair.en;
  if (language === 'zh') return pair.zh;
  return pair.en === pair.zh ? pair.en : `${pair.en} · ${pair.zh}`;
}
