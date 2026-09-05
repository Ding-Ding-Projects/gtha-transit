'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, Zap } from 'lucide-react';
import { resolveTorontoTime, torontoLocalInput, torontoTomorrowAtNine, updateTorontoInputPart } from '../lib/journey-utils';

export default function JourneyTimeControls({ value, instant, arriveBy, onChange, onModeChange, t }: {
  value: string;
  instant?: string;
  arriveBy: boolean;
  onChange: (value: string, instant?: string) => void;
  onModeChange: (value: boolean) => void;
  t: (en: string, zh: string) => string;
}) {
  const [date = '', time = ''] = value.split('T');
  const [edited, setEdited] = useState(false);
  const timeInput = useRef<HTMLInputElement>(null);
  let validation = '';
  let offset = '';
  try {
    const resolved = new Date(resolveTorontoTime(value, instant));
    offset = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', timeZoneName: 'longOffset' })
      .formatToParts(resolved).find(part => part.type === 'timeZoneName')?.value ?? '';
  }
  catch (error) {
    validation = error instanceof Error && error.message.includes('clocks move forward')
      ? t('This time is skipped when Toronto clocks move forward. Choose another time.', '多倫多轉夏令時間會跳過呢個時間，請選擇另一個時間。')
      : t('Choose both a valid date and time.', '請選擇有效日期同時間。');
  }
  useEffect(() => { timeInput.current?.setCustomValidity(validation); }, [validation]);
  const describedBy = `journey-time-zone${edited && validation ? ' journey-time-error' : ''}`;
  return <fieldset className="journey-time">
    <legend>{t('When are you travelling?', '幾時出發？')}</legend>
    <div className="journey-time-mode">
      {[false, true].map(mode => <label key={String(mode)} className="journey-time-mode-choice">
        <input type="radio" name="journey-time-mode" checked={arriveBy === mode}
          onChange={() => onModeChange(mode)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
        <span>{mode ? t('Arrive by', '到達時間') : t('Depart at', '出發時間')}</span>
      </label>)}
    </div>
    <div className="journey-time-fields">
      <label htmlFor="journey-date">
        <span><CalendarDays size={16} aria-hidden="true" />{t('Date', '日期')}</span>
        <input id="journey-date" type="date" required value={date} aria-describedby={describedBy}
          aria-invalid={edited && !date ? true : undefined}
          onChange={event => { setEdited(true); onChange(updateTorontoInputPart(value, 'date', event.target.value)); }} />
      </label>
      <label htmlFor="journey-time">
        <span><Clock size={16} aria-hidden="true" />{t('Time', '時間')}</span>
        <input ref={timeInput} id="journey-time" type="time" required value={time} aria-describedby={describedBy}
          aria-invalid={edited && validation ? true : undefined}
          onChange={event => { setEdited(true); onChange(updateTorontoInputPart(value, 'time', event.target.value)); }} />
      </label>
    </div>
    <p id="journey-time-zone" className="journey-time-zone">{t('Toronto time', '多倫多時間')} · America/Toronto{offset ? ` · ${offset}` : ''}</p>
    {edited && validation && <output id="journey-time-error" className="journey-time-error">{validation}</output>}
    <div className="journey-time-presets">
      <button type="button" onClick={() => {
        const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
        setEdited(true); onModeChange(false); onChange(torontoLocalInput(now), now.toISOString());
      }}><Zap size={15} aria-hidden="true" />{t('Leave now', '而家出發')}</button>
      <button type="button" onClick={() => { setEdited(true); onChange(torontoTomorrowAtNine()); }}>
        {t('Tomorrow at 9', '聽朝 9 點')}
      </button>
    </div>
  </fieldset>;
}
