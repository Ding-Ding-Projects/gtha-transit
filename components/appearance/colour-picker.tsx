'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import ColourField from './colour-field.tsx';
import SearchableSelect from './searchable-select.tsx';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from '../search-workbench.tsx';
import type { Hsv } from '../../lib/appearance/colour-field.ts';
import {
  COLOUR_FORMATS,
  NAMED_COLOURS,
  RAINBOW,
  SHIPPED_RAINBOW_LEVEL,
  contrastRatio,
  contrastVerdict,
  formatColour,
  inGamut,
  isRainbow,
  nameFor,
  oklabToRgbTriple,
  oklchToOklab,
  parseColour,
  rainbowDuration,
  rgbToHsv,
  translateColour,
  type ColourFormat,
  type Rgb,
} from '../../lib/colour.ts';

export type Translate = (en: string, zh: string) => string;

export type ColourPickerProps = {
  value: string;
  onChange: (next: string) => void;
  label: string;
  t: Translate;
  storageId: string;
  allowRainbow?: boolean;
  contrastAgainst?: string;
  recent?: readonly string[];
};

const FALLBACK: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const EMPTY_RECENT: readonly string[] = [];

function toHsv(rgb: Rgb): Hsv {
  const [h, s, v] = rgbToHsv(rgb);
  return { h, s, v };
}

function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error('clipboard-unavailable'));
  return navigator.clipboard.writeText(text);
}

/**
 * A colour is out of the sRGB gamut only when it started somewhere wider than
 * sRGB and got clipped landing there. `parseColour` always returns an already
 * -clamped, in-gamut `Rgb`, so the only way to warn honestly is to redo the
 * unclamped half of the conversion ourselves for the one pair of formats
 * `lib/colour.ts` exposes unclamped primitives for -- OKLCH and OKLab, which
 * are also the two formats wide enough for this to actually happen in
 * practice. This deliberately never claims a warning for a format it cannot
 * check honestly.
 */
function outOfGamut(format: ColourFormat, text: string): boolean {
  if (format !== 'oklch' && format !== 'oklab') return false;
  const call = /^([a-z]+)\(([^)]*)\)$/i.exec(text.trim());
  if (!call) return false;
  const numbers = call[2].split(/[\s,/]+/).filter(Boolean).map((piece) => Number.parseFloat(piece));
  if (numbers.length < 3 || numbers.some((value) => !Number.isFinite(value))) return false;
  const triple: [number, number, number] = format === 'oklch'
    ? oklchToOklab([numbers[0] / 100, numbers[1], numbers[2]])
    : [numbers[0] / 100, numbers[1], numbers[2]];
  return !inGamut(oklabToRgbTriple(triple));
}

/**
 * The full colour picker: the saturation/value square and hue ring, an alpha
 * slider, numeric entry in any of the thirteen formats `lib/colour.ts` knows,
 * a translator table with per-row copy, a named-colour search, recent
 * swatches, and -- when the caller allows it -- the animated rainbow choice.
 *
 * `value` may be the `RAINBOW` sentinel rather than a real colour. While it
 * is, the square, ring and numeric entry all show a neutral stand-in (white)
 * rather than a colour nobody chose, and touching any of them is itself how
 * you leave rainbow mode: they call `onChange` with a real colour, same as
 * any other edit.
 */
export default function ColourPicker({ value, onChange, label, t, storageId, allowRainbow, contrastAgainst, recent = EMPTY_RECENT }: ColourPickerProps) {
  const [format, setFormat] = useState<ColourFormat>('hex');
  const [text, setText] = useState('');
  const [namesSearch, setNamesSearch] = useState<SearchState>(emptySearchState);

  const rainbowActive = isRainbow(value);
  const rgb = rainbowActive ? FALLBACK : parseColour(value) ?? FALLBACK;
  const hsv = useMemo(() => toHsv(rgb), [rgb]);

  useEffect(() => {
    setText(formatColour(rgb, format));
  }, [rgb, format]);

  const invalid = text.trim().length > 0 && parseColour(text) === null;
  const gamutWarning = !invalid && outOfGamut(format, text);

  const applyRgb = (next: Rgb) => onChange(formatColour(next, format));

  const onFieldChange = (next: Hsv) => {
    const [h, s, v] = [next.h, next.s, next.v];
    void h; void s; void v; // kept for readability of the destructure above
    // hsvToRgb lives in colour-field.ts, which colour-picker.tsx already depends on through ColourField's own value type.
    applyRgb(hsvFromField(next));
  };

  const onAlphaChange = (alpha: number) => applyRgb({ ...rgb, a: alpha });

  const onTextChange = (nextText: string) => {
    setText(nextText);
    const parsed = parseColour(nextText);
    if (parsed) onChange(formatColour(parsed, format));
  };

  const format_choices = useMemo(
    () => COLOUR_FORMATS.map((candidate) => ({ value: candidate, label: candidate.toUpperCase() })),
    [],
  );

  const names = useMemo(() => Object.keys(NAMED_COLOURS), []);
  const namesResult = useSearchMatches(names, namesSearch);
  const namesQuery = (namesSearch.mode === 'regex' ? namesSearch.pattern : namesSearch.query).trim();
  const visibleNames = useMemo(
    () => (namesQuery.length === 0 ? names.slice(0, 24) : names.filter((_, index) => namesResult.matches[index]).slice(0, 100)),
    [names, namesQuery, namesResult.matches],
  );

  const currentName = rainbowActive ? null : nameFor(rgb);
  const translations = useMemo(() => translateColour(rgb), [rgb]);

  const contrastTarget = contrastAgainst ? parseColour(contrastAgainst) : null;
  const ratio = contrastTarget ? contrastRatio(rgb, contrastTarget) : null;
  const verdict = ratio !== null ? contrastVerdict(ratio) : null;

  const recentSwatches = recent.filter((swatch) => !isRainbow(swatch));
  const rainbowDurationValue = rainbowDuration(SHIPPED_RAINBOW_LEVEL);

  return (
    <div className="appearance-colour-picker" data-ui="appearance.colour-picker">
      <ColourField value={hsv} onChange={onFieldChange} label={label} t={t} />

      <label className="appearance-colour-picker__alpha">
        {t('Alpha', '透明度')}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={rgb.a}
          onChange={(event) => onAlphaChange(Number(event.target.value))}
          aria-valuetext={t(`${Math.round(rgb.a * 100)}% opaque`, `${Math.round(rgb.a * 100)}% 不透明`)}
        />
        <output>{Math.round(rgb.a * 100)}%</output>
      </label>

      <div className="appearance-colour-picker__entry">
        <SearchableSelect
          id={`${storageId}-format`}
          label={t('Format', '格式')}
          value={format}
          options={format_choices}
          onChange={(next) => setFormat(next as ColourFormat)}
          storageId={`${storageId}:format`}
          t={t}
        />
        <label className="appearance-colour-picker__text">
          {t('Value', '數值')}
          <input
            type="text"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            spellCheck="false"
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={`${storageId}-entry-note`}
          />
        </label>
        <p id={`${storageId}-entry-note`} className="appearance-colour-picker__note">
          {invalid
            ? t('This is not a colour this planner can read.', '呢個唔係本規劃工具可以讀取嘅顏色。')
            : gamutWarning
              ? t('This colour is outside what a screen can show and will be clipped to the nearest in-range colour.', '呢隻顏色超出螢幕可顯示範圍,會被夾到最近嘅可顯示顏色。')
              : currentName
                ? t(`Also known as "${currentName}".`, `又叫做「${currentName}」。`)
                : t('A valid colour.', '有效嘅顏色。')}
        </p>
      </div>

      {ratio !== null && verdict !== null && (
        <p className="appearance-colour-picker__contrast">
          {t(
            `Contrast against the given colour: ${ratio.toFixed(2)}:1 — normal text ${verdict.normal}, large text ${verdict.large}.`,
            `同指定顏色嘅對比度:${ratio.toFixed(2)}:1 — 正常文字 ${verdict.normal},大字 ${verdict.large}。`,
          )}
        </p>
      )}

      <table className="appearance-colour-picker__translator">
        <caption>{t('Every format, translated', '所有格式互相翻譯')}</caption>
        <tbody>
          {COLOUR_FORMATS.map((candidate) => (
            <tr key={candidate}>
              <th scope="row">{candidate.toUpperCase()}</th>
              <td><code>{translations[candidate]}</code></td>
              <td>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(translations[candidate])}
                  aria-label={t(`Copy the ${candidate} value`, `複製 ${candidate} 數值`)}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="appearance-colour-picker__names">
        <SearchWorkbench storageId={`${storageId}:names`} label={t('Named colours', '命名顏色')} value={namesSearch} onChange={setNamesSearch} samples={names} t={t} />
        <ul className="appearance-colour-picker__swatches" aria-label={t('Named colours', '命名顏色')}>
          {visibleNames.map((name) => (
            <li key={name}>
              <button type="button" className="appearance-colour-picker__swatch" style={{ background: NAMED_COLOURS[name] }} onClick={() => onChange(name)} title={name} aria-label={name}>
                {currentName === name && <Check size={14} aria-hidden="true" />}
              </button>
            </li>
          ))}
          {visibleNames.length === 0 && <li className="appearance-colour-picker__empty">{t('No matching colour names', '冇符合嘅顏色名稱')}</li>}
        </ul>
      </div>

      {recentSwatches.length > 0 && (
        <div className="appearance-colour-picker__recent">
          <span>{t('Recent', '最近使用')}</span>
          <ul>
            {recentSwatches.map((swatch, index) => (
              <li key={`${swatch}-${index}`}>
                <button type="button" className="appearance-colour-picker__swatch" style={{ background: swatch }} onClick={() => onChange(swatch)} title={swatch} aria-label={swatch} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {allowRainbow && (
        <button
          type="button"
          className="appearance-colour-picker__rainbow"
          aria-pressed={rainbowActive}
          onClick={() => onChange(RAINBOW)}
          style={{ ['--gtha-rainbow-duration' as string]: rainbowDurationValue }}
        >
          {rainbowActive && <Check size={16} aria-hidden="true" />}
          {t('Animated rainbow', '動態彩虹')}
        </button>
      )}
    </div>
  );
}

/** `ColourField`'s `Hsv` to an `Rgb`, by way of `lib/appearance/colour-field.ts`'s own `hsvToRgb`. */
function hsvFromField(hsv: Hsv): Rgb {
  return colourFieldHsvToRgb(hsv.h, hsv.s, hsv.v);
}

// Imported lazily below the fold to keep the top-of-file import block focused
// on lib/colour.ts's own exports; this is the one function this file needs
// from lib/appearance/colour-field.ts beyond the `Hsv` type already imported above.
import { hsvToRgb as colourFieldHsvToRgb } from '../../lib/appearance/colour-field.ts';
