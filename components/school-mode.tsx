'use client';

import { useId, useState } from 'react';
import { Icon } from './icon';
import {
  MAX_NAME,
  MIN_SECRET,
  RECOVERY,
  lock,
  lockUnavailable,
  renameSchool,
  schoolName,
  secretIsUsable,
  unlock,
  verify,
  type SchoolState,
} from '../lib/school-mode';

type Translate = (en: string, zh: string) => string;

export type SchoolModeProps = {
  t: Translate;
  state: SchoolState;
  setState: (next: SchoolState) => void;
};

/**
 * The School mode control.
 *
 * It stays discoverable while the mode is on -- it is the only way back out --
 * and it is the one surface that keeps working when everything it hides has gone.
 *
 * Two things it is careful to say. The name a person chooses replaces the shipped
 * one here and everywhere else, so nothing gives away what the mode is called by
 * default. And it states plainly that this is a lock somebody puts on themselves
 * rather than a protection: clearing site data turns it off, and that is written
 * on the control rather than left to be discovered.
 */
export default function SchoolMode({ t, state, setState }: SchoolModeProps) {
  const id = useId().replaceAll(':', '');
  const [secret, setSecret] = useState('');
  const [name, setName] = useState(state.name);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [broke, setBroke] = useState('');
  const shown = schoolName(state);
  /*
   * Asked before the control is offered, not discovered when somebody presses it.
   * On a plain http origin there is no WebCrypto, so the lock cannot be set --
   * and silently doing nothing is exactly what this did until the deployed build
   * was driven.
   */
  const unavailable = lockUnavailable(t);

  /* Both paths report a throw rather than swallowing it. A promise that rejects
     inside an onClick is invisible: the button appears to do nothing at all. */
  const turnOn = async () => {
    if (!secretIsUsable(secret) || busy || unavailable) return;
    setBusy(true);
    setBroke('');
    try {
      setState(await lock(renameSchool(state, name), secret));
      setSecret('');
    } catch {
      setBroke(t('That did not work, and the mode was not turned on.', '搞唔掂，個模式冇開到。'));
    }
    setBusy(false);
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    setBroke('');
    try {
      const correct = await verify(state, secret);
      setWrong(!correct);
      if (correct) { setState(unlock(state)); setSecret(''); }
    } catch {
      setBroke(t('That did not work, and the mode is still on.', '搞唔掂，個模式仲開住。'));
    }
    setBusy(false);
  };

  return (
    <section className="preference-card school-mode" aria-labelledby={`${id}-heading`}>
      <div className="preference-card-heading">
        <Icon name="check_circle" size={23} />
        <div>
          {/* The chosen name, never the shipped one once there is a choice. */}
          <h3 id={`${id}-heading`}>{shown}</h3>
          <p>
            {t(
              'Put the planner into plain English and put the playful bits away.',
              'Switch the planner into plain English and put the playful bits away.',
            )}
          </p>
        </div>
      </div>

      {state.on ? (
        <>
          <p className="school-mode__on">
            {t(`${shown} is on. The planner is in plain English.`, `${shown} is on. The planner is in plain English.`)}
          </p>
          <div className="school-mode__row">
            <label htmlFor={`${id}-unlock`}>{t('Enter your word or number to turn it off', 'Enter your word or number to turn it off')}</label>
            <input
              id={`${id}-unlock`}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => { setSecret(event.target.value); setWrong(false); }}
            />
            <button type="button" onClick={() => void turnOff()} disabled={busy || secret.length === 0}>
              {t(`Turn off ${shown}`, `Turn off ${shown}`)}
            </button>
          </div>
          {wrong && (
            <output className="school-mode__wrong" aria-live="polite">
              {t('That is not it. Try again.', 'That is not it. Try again.')}
            </output>
          )}
        </>
      ) : unavailable ? (
        /* Said instead of the fields, because a form that cannot be submitted is
           worse than no form: it looks like the person got something wrong. */
        <p className="school-mode__unavailable">{unavailable}</p>
      ) : (
        <>
          <div className="school-mode__row">
            <label htmlFor={`${id}-name`}>{t('Call it something else, if you like', 'Call it something else, if you like')}</label>
            <input
              id={`${id}-name`}
              type="text"
              maxLength={MAX_NAME}
              value={name}
              placeholder={shown}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="school-mode__row">
            <label htmlFor={`${id}-secret`}>{t('A word or number to turn it off again', 'A word or number to turn it off again')}</label>
            <input
              id={`${id}-secret`}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
            <button type="button" onClick={() => void turnOn()} disabled={busy || !secretIsUsable(secret)}>
              {t('Turn it on', 'Turn it on')}
            </button>
          </div>
          {!secretIsUsable(secret) && secret.length > 0 && (
            <output className="school-mode__hint" aria-live="polite">
              {t(`At least ${MIN_SECRET} characters.`, `At least ${MIN_SECRET} characters.`)}
            </output>
          )}
        </>
      )}

      {broke && <output className="school-mode__wrong" aria-live="polite">{broke}</output>}

      {/*
        * Said on the control, not buried. A lock somebody sets on themselves is a
        * lock they will sometimes forget, and one with no way out is a wall.
        */}
      <p className="school-mode__honesty">
        <strong>{t('This is a speed bump, not a lock on your data.', 'This is a speed bump, not a lock on your data.')}</strong>{' '}
        {t(RECOVERY.en, RECOVERY.en)}
      </p>
    </section>
  );
}
