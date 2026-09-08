'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icon';
import { useLocalSetting } from '../lib/use-local-setting';
import {
  ADHD_MODES,
  ADHD_STORAGE_KEY,
  IDLE_MS,
  MAX_ONE_THING,
  elapsedMinutes,
  idleMinutes,
  isOn,
  momentumDue,
  parseAdhd,
  serializeAdhd,
  setOneThing,
  snooze,
  toggleMode,
  type AdhdMode,
  type AdhdState,
} from '../lib/adhd-modes';
import {
  VOCABULARY_LIMITS,
  VOCABULARY_STORAGE_KEY,
  entryCount,
  readVocabulary,
  rejectionText,
  serializeVocabulary,
  type VocabularyFile,
} from '../lib/personal-vocabulary';

type Translate = (en: string, zh: string) => string;

export type ComfortSettingsProps = {
  t: Translate;
  adhd: AdhdState;
  setAdhd: (next: AdhdState | ((current: AdhdState) => AdhdState)) => void;
  vocabulary: VocabularyFile | null;
  setVocabulary: (next: VocabularyFile | null) => void;
  /**
   * Leave the wording card out entirely.
   *
   * School mode sets this. A card that stayed and refused would say what had been
   * turned off, and a loaded file is not cleared -- it is simply not applied, and
   * it comes back with the card.
   */
  hideVocabulary?: boolean;
};

/**
 * Copy for each mode.
 *
 * Named for what they DO, so somebody can use one without disclosing anything
 * about themselves to a colleague reading over their shoulder. Nothing here is
 * medical: no diagnosis, no assessment, no advice, no claim of benefit, and
 * nothing that reads as scolding, a streak or a score.
 */
const MODE_COPY: Record<AdhdMode, { title: [string, string]; detail: [string, string]; glyph: string }> = {
  focus: {
    title: ['Focus', '專注'],
    detail: ['Bring what you are working on forward and push the rest back. Nothing is hidden that one obvious action cannot bring back.', '將你而家做緊嘅嘢突出，其餘淡化。唔會收埋任何一撳就搵唔返嘅嘢。'],
    glyph: 'my_location',
  },
  lowStimulation: {
    title: ['Low stimulation', '低刺激'],
    detail: ['Fewer moving things, quieter colour, and only the notifications that genuinely need a person.', '少啲郁動，顏色柔和啲，只留真係要人處理嘅通知。'],
    glyph: 'layers',
  },
  timeAwareness: {
    title: ['Time awareness', '時間感'],
    detail: ['Show how long this session has been open, and how long since anything changed.', '顯示今次用咗幾耐，同上次有改動之後過咗幾耐。'],
    glyph: 'schedule',
  },
  oneThing: {
    title: ['One thing at a time', '一次一件事'],
    detail: ['Keep one next action visible, chosen by you, so it survives a context switch.', '由你自己揀一件下一步嘅事擺喺眼前，就算轉咗去做第二樣都仲喺度。'],
    glyph: 'check_circle',
  },
  momentum: {
    title: ['Momentum', '節奏'],
    detail: ['A quiet, dismissible prompt when something has been sitting untouched.', '有嘢擺低咗好耐冇郁，會靜靜哋提你一句，撳走得。'],
    glyph: 'refresh',
  },
};

/**
 * Comfort and wording: the ADHD modes and the personal-vocabulary file.
 *
 * They share a settings section because they share a purpose -- making the
 * planner fit the person rather than the other way round -- and because both are
 * entirely local: nothing here is sent anywhere, and nothing here is on until
 * somebody turns it on.
 */
export default function ComfortSettings({ t, adhd, setAdhd, vocabulary, setVocabulary, hideVocabulary }: ComfortSettingsProps) {
  const id = useId().replaceAll(':', '');
  const storedAdhd = useLocalSetting(ADHD_STORAGE_KEY);
  const storedVocabulary = useLocalSetting(VOCABULARY_STORAGE_KEY);
  const [rejection, setRejection] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const picker = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    setAdhd(parseAdhd(storedAdhd.value));
  }, [storedAdhd.value, setAdhd]);

  useEffect(() => {
    if (!restored.current) return;
    storedAdhd.setValue(serializeAdhd(adhd));
  }, [adhd, storedAdhd]);

  /* The clock only ticks while somebody is looking at it. A minute interval for a
     readout in whole minutes is the cheapest thing that is never wrong by more
     than the unit it displays. */
  useEffect(() => {
    if (!isOn(adhd, 'timeAwareness') && !isOn(adhd, 'momentum')) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [adhd]);

  const choose = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setRejection('');
    if (file.size > VOCABULARY_LIMITS.maxBytes) {
      setRejection(rejectionText('too-large', t));
      return;
    }
    const text = await file.text();
    const result = readVocabulary(text);
    if (!result.ok) {
      // Nothing is applied, not even the entries before the bad one.
      setRejection(rejectionText(result.reason, t));
      return;
    }
    setVocabulary(result.file);
    storedVocabulary.setValue(serializeVocabulary(result.file));
  };

  const clear = () => {
    setRejection('');
    setVocabulary(null);
    storedVocabulary.setValue('');
    if (picker.current) picker.current.value = '';
  };

  const loaded = entryCount(vocabulary);

  return (
    <div className="comfort">
      <section className="preference-card comfort-modes" aria-labelledby={`${id}-modes`}>
        <div className="preference-card-heading">
          <Icon name="tune" size={23} />
          <div>
            <h3 id={`${id}-modes`}>{t('Comfort modes', '舒適模式')}</h3>
            <p>{t('Five separate accommodations. Turn on only the ones you want.', '五個獨立設定，想開邊個就開邊個。')}</p>
          </div>
        </div>

        <ul className="comfort-mode-list">
          {ADHD_MODES.map((mode) => (
            <li key={mode}>
              <label htmlFor={`${id}-${mode}`}>
                <input
                  id={`${id}-${mode}`}
                  type="checkbox"
                  role="switch"
                  checked={isOn(adhd, mode)}
                  onChange={() => setAdhd((current) => toggleMode(current, mode))}
                />
                <Icon name={MODE_COPY[mode].glyph} size={20} />
                <span>
                  <strong>{t(...MODE_COPY[mode].title)}</strong>
                  <small>{t(...MODE_COPY[mode].detail)}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <p className="settings-default">
          {t(
            'All five ship off. These are accommodations, not an opinion about how anybody should work, and nothing here is medical advice.',
            '五個都預設關閉。呢啲係方便你嘅設定，唔係話人應該點做嘢，亦都唔係醫療建議。',
          )}
        </p>

        {isOn(adhd, 'oneThing') && (
          <div className="comfort-one-thing">
            <label htmlFor={`${id}-one-thing`}>{t('The one thing', '嗰一件事')}</label>
            <input
              id={`${id}-one-thing`}
              type="text"
              maxLength={MAX_ONE_THING}
              value={adhd.oneThingText}
              placeholder={t('Whatever you decide it is', '你話係咩就係咩')}
              onChange={(event) => setAdhd((current) => setOneThing(current, event.target.value))}
            />
          </div>
        )}

        {isOn(adhd, 'timeAwareness') && (
          <output className="comfort-clock" aria-live="off">
            {t(
              `This session has been open ${elapsedMinutes(adhd, now)} minutes. Nothing has changed for ${idleMinutes(adhd, now)}.`,
              `今次已經開咗 ${elapsedMinutes(adhd, now)} 分鐘，有 ${idleMinutes(adhd, now)} 分鐘冇改動過。`,
            )}
          </output>
        )}

        {momentumDue(adhd, now) && (
          <div className="comfort-momentum" role="status">
            {/* What is true, never what somebody should feel about it. */}
            <span>{t(`Nothing has changed here for ${idleMinutes(adhd, now)} minutes.`, `呢度已經 ${idleMinutes(adhd, now)} 分鐘冇改動過。`)}</span>
            <button type="button" onClick={() => setAdhd((current) => snooze(current))}>
              {t('Not now', '而家唔使')}
            </button>
          </div>
        )}
      </section>

      {!hideVocabulary && <section className="preference-card comfort-vocabulary" aria-labelledby={`${id}-vocabulary`}>
        <div className="preference-card-heading">
          <Icon name="translate" size={23} />
          <div>
            <h3 id={`${id}-vocabulary`}>{t('Your own wording', '你自己嘅用語')}</h3>
            <p>{t('Load a JSON file of your words and the planner will use them instead of ours.', '揀一個你自己用語嘅 JSON 檔，規劃工具就會用你嘅字眼。')}</p>
          </div>
        </div>

        <div className="comfort-vocabulary-control">
          <label className="comfort-vocabulary-picker" htmlFor={`${id}-vocabulary-file`}>
            <Icon name="add" size={20} />
            <span>{loaded ? t('Replace the file', '換另一個檔案') : t('Choose a file', '揀一個檔案')}</span>
          </label>
          <input
            ref={picker}
            id={`${id}-vocabulary-file`}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void choose(event.target.files)}
          />
          {loaded > 0 && (
            <button type="button" onClick={clear}>
              <Icon name="close" size={18} />
              {t('Clear and restore the original wording', '清除並還原原本用語')}
            </button>
          )}
        </div>

        <output className="comfort-vocabulary-state" aria-live="polite">
          {rejection
            ? rejection
            : loaded > 0
              ? t(`${loaded} of your words are in use.`, `已套用你 ${loaded} 個用語。`)
              : t('No file is loaded, so the planner is using its own wording.', '未載入檔案，所以而家用緊規劃工具本身嘅用語。')}
        </output>

        {storedVocabulary.unavailable && (
          <output className="settings-notice">
            {t('Your file could not be saved in this browser. It still applies for this visit.', '呢個瀏覽器未能儲存你嘅檔案，今次使用仍然有效。')}
          </output>
        )}

        <details className="comfort-vocabulary-format">
          <summary>{t('What the file looks like', '個檔案長成點')}</summary>
          {/* The shape, with no words in it. A sample vocabulary here would be this
              planner shipping wording nobody asked for, which is the one thing this
              feature must never do. */}
          <pre>{`{
  "version": ${VOCABULARY_LIMITS.schemaVersion},
  "entries": [
    { "term": "", "replacement": "" }
  ]
}`}</pre>
          <p>
            {t(
              `At most ${VOCABULARY_LIMITS.maxEntries} entries and ${VOCABULARY_LIMITS.maxBytes / 1024} KB. A term is matched as a whole word, keeping the capitalisation it had. Nothing else in the planner changes: commands, addresses, route numbers and official notices keep their own words.`,
              `最多 ${VOCABULARY_LIMITS.maxEntries} 條，${VOCABULARY_LIMITS.maxBytes / 1024} KB。配對成個字，保留原本大細楷。其餘唔會變：指令、地址、路線號碼同官方通告都會保持原文。`,
            )}
          </p>
          <p>
            <strong>
              {t(
                'The file stays in this browser. It is never uploaded, never logged, and never included in an export.',
                '個檔案只留喺呢個瀏覽器，唔會上載、唔會寫入記錄、亦唔會出現喺任何匯出檔。',
              )}
            </strong>
          </p>
        </details>
      </section>}
    </div>
  );
}
