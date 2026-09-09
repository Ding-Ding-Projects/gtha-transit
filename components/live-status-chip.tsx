import { Ban, CircleAlert, CircleCheck, CircleHelp, Clock, History } from 'lucide-react';
import { describeState, STATE_ICONS, type LiveLegStatus, type LiveState } from '../lib/live-status';

/**
 * Renders the icon `STATE_ICONS` names, at a given size.
 *
 * This picks the JSX element with a `switch` over stable, literal tags
 * (`<CircleCheck/>`, `<CircleAlert/>`, ...) rather than choosing a component
 * *reference* and rendering it as a dynamic `<IconComponent/>` tag -- the
 * react-compiler flags the latter as creating a component during render,
 * because from the compiler's view a JSX tag that is a locally computed
 * variable is indistinguishable from one that defines a fresh component
 * every render. `STATE_ICONS` (from `lib/live-status.ts`) hands back a plain
 * `string`, so anything it did not literally list here falls back to
 * `CircleHelp`, which is what `lib/live-status.ts` itself uses for its own
 * `'unknown'`/`'live-unmatched'` states.
 */
function stateIcon(name: string, size: number) {
  const props = { size, 'aria-hidden': true as const };
  switch (name) {
    case 'CircleCheck':
      return <CircleCheck {...props} />;
    case 'CircleAlert':
      return <CircleAlert {...props} />;
    case 'Ban':
      return <Ban {...props} />;
    case 'Clock':
      return <Clock {...props} />;
    case 'History':
      return <History {...props} />;
    case 'CircleHelp':
    default:
      return <CircleHelp {...props} />;
  }
}

/**
 * The class/legend suffix a chip actually paints with -- every `LiveState`
 * value, plus `'very-late'`, which is not a `LiveState` of its own. OTP and
 * `classifyLeg`/`classifyStop` never hand back a `state` of `'very-late'`;
 * they hand back `state: 'late'` with a `tier: 'very-late'` riding beside it.
 * `visualState` is where that tier is finally read, so the theme's separate
 * `--gt-status-very-late-*` roles (and the `.live-status--very-late` class
 * they paint) are reachable at all -- without it every late leg, three
 * minutes or thirty, paints identically amber.
 */
type VisualState = LiveState | 'very-late';
const visualState = (state: LiveState, tier: LiveLegStatus['tier']): VisualState =>
  tier === 'very-late' ? 'very-late' : state;

/** A representative delay for the legend row, chosen to land inside the state it names. */
const LEGEND_DELAY_MINUTES: Partial<Record<VisualState, number>> = {
  early: -2,
  'on-time': 0,
  late: 4,
  'very-late': 8,
  cancelled: 0,
};

/**
 * Display order for the legend: the state a row's icon and word come from,
 * and the (possibly finer) visual state its colour and class come from. Two
 * rows share `state: 'late'` -- the ordinary and the very-late tier -- because
 * they read the same aside from the minute count, but the colour role and
 * class genuinely differ, and a legend that never shows the red tier does not
 * explain what a rider actually sees on a badly delayed leg.
 */
const LEGEND_ROWS: readonly { visual: VisualState; state: LiveState }[] = [
  { visual: 'early', state: 'early' },
  { visual: 'on-time', state: 'on-time' },
  { visual: 'late', state: 'late' },
  { visual: 'very-late', state: 'late' },
  { visual: 'cancelled', state: 'cancelled' },
  { visual: 'scheduled-only', state: 'scheduled-only' },
  { visual: 'live-unmatched', state: 'live-unmatched' },
  { visual: 'stale', state: 'stale' },
  { visual: 'unknown', state: 'unknown' },
];

export type LiveStatusChipProps = {
  status: LiveLegStatus;
  t: (english: string, cantonese: string) => string;
  /** A smaller chip for a tight row; the icon shrinks, the text does not disappear. */
  compact?: boolean;
  /** The timetable instant, shown struck through when it differs from `liveTime`. */
  scheduledTime?: string;
  /** The instant actually shown as this leg's time -- live-preferred, same as the row beside it. */
  liveTime?: string;
  /** Renders an instant the way the surrounding page already does; defaults to passing it through. */
  timeFormatter?: (value: string) => string;
};

/**
 * One leg's delay state: an icon, a word, and -- only when it would tell the
 * rider something new -- the timetable instant struck through beside the live
 * one. Colour never carries the meaning alone.
 */
export default function LiveStatusChip({ status, t, compact, scheduledTime, liveTime, timeFormatter }: LiveStatusChipProps) {
  const visual = visualState(status.state, status.tier);
  const { en, zh } = describeState(status.state, status.delayMinutes);
  const format = timeFormatter ?? ((value: string) => value);
  const showScheduled = Boolean(scheduledTime && liveTime && scheduledTime !== liveTime);
  return (
    <span className={`live-status live-status--${visual}`} data-live-state={visual}>
      {stateIcon(STATE_ICONS[status.state], compact ? 14 : 16)}
      <span className="live-status__label">{t(en, zh)}</span>
      {showScheduled && (
        <s className="live-status__scheduled">
          <span className="sr-only">{t('timetable', '時間表')} </span>
          {format(scheduledTime as string)}
        </s>
      )}
    </span>
  );
}

/** Every state the chip can show, each with its own icon, colour and word. */
export function LiveLegend({ t }: { t: (english: string, cantonese: string) => string }) {
  return (
    <dl className="live-status-legend">
      {LEGEND_ROWS.map(({ visual, state }) => {
        const { en, zh } = describeState(state, LEGEND_DELAY_MINUTES[visual] ?? 0);
        return (
          <div className="live-status-legend__row" key={visual}>
            <dt>
              <span className={`live-status live-status--${visual}`} data-live-state={visual}>
                {stateIcon(STATE_ICONS[state], 16)}
                <span className="live-status__label">{t(en, zh)}</span>
              </span>
            </dt>
          </div>
        );
      })}
    </dl>
  );
}
