'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from './icon';
import {
  authorise,
  awaiting,
  cancelConfirm,
  idleConfirm,
  isArmed,
  isAuthorised,
  isSwept,
  moveSlider,
  turnKey,
  type ConfirmState,
  type DestructiveAction,
} from '../lib/super-confirm';

type Translate = (en: string, zh: string) => string;

export type SuperConfirmProps = {
  open: boolean;
  action: DestructiveAction;
  onConfirm: () => void;
  onCancel: () => void;
  t: Translate;
  /** The control that opened this, so focus can go back to it. */
  origin?: HTMLElement | null;
};

/**
 * The gate in front of anything irreversible.
 *
 * Two keys, turned independently, then a slider dragged its whole length. It is
 * deliberately awkward, because the actions behind it cannot be undone and a
 * single confirm button is a thing people press without reading.
 *
 * What the awkwardness must never obscure is what is about to happen. The title
 * and the detail are rendered exactly as the caller gave them, and the caller is
 * required to have put the count and the names in them; `describesTheAction`
 * refuses a gate that does not.
 *
 * Everything here is operable from the keyboard. The slider is a native range
 * input, so arrow keys sweep it and a screen reader reads its position without
 * any of this having to reimplement either. The emergency exit is always
 * reachable and never disabled: a person who wants out of a destructive dialog
 * gets out of it.
 */
export default function SuperConfirm({ open, action, onConfirm, onCancel, t, origin }: SuperConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ConfirmState>(idleConfirm);
  const id = useId().replaceAll(':', '');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setState(idleConfirm());
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const leave = () => {
    setState(cancelConfirm());
    onCancel();
    origin?.focus();
  };

  /*
   * Authorising is guarded twice on purpose. The button is disabled until the
   * sweep is complete, which is the visible guard, and `authorise` refuses an
   * incomplete or already-authorised state, which is the real one: a disabled
   * button does not stop a keyboard submit, and the action behind this cannot be
   * taken back if it runs twice.
   */
  const confirm = () => {
    const next = authorise(state);
    if (!isAuthorised(next)) return;
    setState(next);
    onConfirm();
    origin?.focus();
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    leave();
  };

  const armed = isArmed(state);
  const swept = isSwept(state);
  const waiting = awaiting(state);
  const waitingText = {
    'both-keys': t('Turn both keys to unlock the slider.', '扭開兩把匙先可以拉滑桿。'),
    'left-key': t('Turn the first key as well.', '仲要扭開第一把匙。'),
    'right-key': t('Turn the second key as well.', '仲要扭開第二把匙。'),
    sweep: t('Now drag the slider all the way to the end.', '而家將滑桿拉到最尾。'),
    done: t('Done.', '完成。'),
  }[waiting];

  return (
    <dialog ref={dialog} className="super-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-detail`} onCancel={(event) => { event.preventDefault(); leave(); }}>
      <div className="super-confirm__surface" onKeyDown={onKey}>
        <div className="super-confirm__head">
          <Icon name="warning" size={28} className="super-confirm__warning" />
          <div>
            {/* Never styled away by a funny level: this is the sentence the gate exists for. */}
            <h2 id={`${id}-title`}>{action.title}</h2>
            <p id={`${id}-detail`} className="super-confirm__detail">{action.detail}</p>
          </div>
        </div>

        {action.consequences && action.consequences.length > 0 && (
          <ul className="super-confirm__consequences">
            {action.consequences.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}

        <p className="super-confirm__irreversible">
          <strong>{t('This cannot be undone.', '呢個操作無法還原。')}</strong>
        </p>

        <fieldset className="super-confirm__keys">
          <legend>{t('Turn both keys', '扭開兩把匙')}</legend>
          {(['left', 'right'] as const).map((key, index) => (
            <label key={key} className={`super-confirm__key${state[key] ? ' is-turned' : ''}`}>
              <input
                id={`${id}-key-${key}`}
                type="checkbox"
                checked={state[key]}
                disabled={isAuthorised(state)}
                onChange={() => setState((current) => turnKey(current, key))}
              />
              <Icon name={state[key] ? 'check_circle' : 'close'} size={22} />
              <span>{index === 0 ? t('First key', '第一把匙') : t('Second key', '第二把匙')}</span>
            </label>
          ))}
        </fieldset>

        <div className={`super-confirm__slider${armed ? ' is-armed' : ''}${swept ? ' is-swept' : ''}`}>
          <label htmlFor={`${id}-sweep`}>{t('Drag to confirm', '拉到底確認')}</label>
          <input
            id={`${id}-sweep`}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.slider}
            disabled={!armed || isAuthorised(state)}
            aria-describedby={`${id}-waiting`}
            onChange={(event) => setState((current) => moveSlider(current, Number(event.target.value)))}
          />
          {/* A track that fills, and a percentage in words beside it, so progress is
              never carried by the fill alone. */}
          <output htmlFor={`${id}-sweep`}>{Math.round(state.slider * 100)}%</output>
        </div>

        <output id={`${id}-waiting`} className="super-confirm__waiting" aria-live="polite">{waitingText}</output>

        <div className="super-confirm__actions">
          {/* Never disabled. Somebody who wants out of a destructive dialog gets out. */}
          <button type="button" className="super-confirm__exit" onClick={leave}>
            <Icon name="close" size={18} />
            {t('Emergency exit', '緊急退出')}
          </button>
          <button type="button" className="super-confirm__go" disabled={!swept || isAuthorised(state)} onClick={confirm}>
            {action.title}
          </button>
        </div>
      </div>
    </dialog>
  );
}
