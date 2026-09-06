import type { SuperExpressMatch } from '../lib/go-express';

type Props = {
  match: SuperExpressMatch;
  t: (en: string, zh: string) => string;
};

/**
 * An original mark for declared super express service. It is deliberately not a
 * reproduction of any operator's trademark: two forward chevrons crossing a
 * speed rule, drawn only from this project's own geometry.
 */
export function SuperExpressMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="super-express-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="22" height="22" rx="7" className="super-express-mark-plate" />
      <path
        d="M6.4 6.6 11.2 12l-4.8 5.4"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="super-express-mark-chevron"
      />
      <path
        d="M12.4 6.6 17.2 12l-4.8 5.4"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="super-express-mark-chevron"
      />
      <path d="M3.4 12h3.1" fill="none" strokeWidth="2.2" strokeLinecap="round" className="super-express-mark-rule" />
    </svg>
  );
}

/**
 * The label never stands on the mark alone: the words carry the meaning, and the
 * declared - rather than published - origin of the classification is stated where
 * a reader can reach it.
 */
export default function SuperExpressBadge({ match, t }: Props) {
  const declared = t(
    'Super express is a classification declared by this project, not a service label published by GO Transit.',
    '「超級特快」係本專案自訂嘅分類，唔係 GO Transit 官方公布嘅服務名稱。',
  );
  return (
    <span className="super-express-badge" title={declared}>
      <SuperExpressMark />
      <span className="super-express-text">
        {t('Super express', '超級特快')}
        <small>{match.identity}</small>
      </span>
      <span className="sr-only">{declared}</span>
    </span>
  );
}
