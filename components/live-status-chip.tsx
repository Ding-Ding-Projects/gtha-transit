import type { LucideIcon } from 'lucide-react';
import { Ban, CircleAlert, CircleCheck, CircleHelp, Clock, History } from 'lucide-react';
import { describeState, STATE_ICONS, type LiveLegStatus, type LiveState } from '../lib/live-status';

type IconName = 'CircleCheck' | 'CircleAlert' | 'Ban' | 'Clock' | 'CircleHelp' | 'History';

const ICONS: Record<IconName, LucideIcon> = {
  CircleCheck,
  CircleAlert,
  Ban,
  Clock,
  CircleHelp,
  History,
};

/** A representative delay for the legend row, chosen to land inside the state it names. */
const LEGEND_DELAY_MINUTES: Partial<Record<LiveState, number>> = {
  early: -2,
  'on-time': 0,
  late: 4,
  'very-late': 8,
  cancelled: 0,
};

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
  const IconComponent = ICONS[STATE_ICONS[status.state]];
  const { en, zh } = describeState(status.state, status.delayMinutes);
  const format = timeFormatter ?? ((value: string) => value);
  const showScheduled = Boolean(scheduledTime && liveTime && scheduledTime !== liveTime);
  return (
    <span className={`live-status live-status--${status.state}`} data-live-state={status.state}>
      <IconComponent size={compact ? 14 : 16} aria-hidden="true" />
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
  const states = Object.keys(STATE_ICONS) as LiveState[];
  return (
    <dl className="live-status-legend">
      {states.map((state) => {
        const IconComponent = ICONS[STATE_ICONS[state]];
        const { en, zh } = describeState(state, LEGEND_DELAY_MINUTES[state] ?? 0);
        return (
          <div className="live-status-legend__row" key={state}>
            <dt>
              <span className={`live-status live-status--${state}`} data-live-state={state}>
                <IconComponent size={16} aria-hidden="true" />
                <span className="live-status__label">{t(en, zh)}</span>
              </span>
            </dt>
          </div>
        );
      })}
    </dl>
  );
}
