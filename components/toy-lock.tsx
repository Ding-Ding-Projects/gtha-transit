'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { Copy, Eye, KeyRound, Lock, LockOpen, Ticket, Timer, X } from 'lucide-react';
import {
  ATTEMPTS_PER_WAIT,
  LOCK_DISCLOSURE,
  LOCK_POLICIES,
  LOCK_RECOVERY,
  MAX_UNLOCK_MINUTES,
  PASSWORD_MAX,
  PIN_MAX,
  PIN_MIN,
  PASSWORD_MIN,
  POLICY_FACTORS,
  draftProblems,
  factorLabel,
  isLockedNow,
  policyLabel,
  targetId,
  type DraftProblem,
  type LockPolicy,
  type LockRecord,
  type LockTarget,
  type UnlockAttempt,
  type UnlockDuration,
} from '../lib/toy-locks';
import {
  DEFAULT_OTP,
  OTP_ALGORITHMS,
  base32Encode,
  buildOtpauthUri,
  generateSecret,
  groupSecret,
  type OtpParameters,
} from '../lib/totp';
import {
  addLock,
  attemptsFor,
  ladderCleared,
  ladderLost,
  newAttempt,
  relock,
  releaseSurface,
  submitFactor,
  useToyLocks,
} from '../lib/use-toy-locks';
import { createLadderSession, ladderAvailability, type Challenge, type LadderDish, type LadderSession, type MoleHit } from '../lib/unlock-ladder';
import { DIM_SUM_MANIFEST, dishImage, parseManifest } from '../lib/dim-sum';

type Translate = (en: string, zh: string) => string;

/** Fired to open a gate's unlock prompt from elsewhere: the settings search, Support Tickets, the lock list. */
export const OPEN_UNLOCK_EVENT = 'gtha-open-unlock';
/** Fired to take somebody to Support Tickets from an unlock prompt. */
export const OPEN_TICKETS_EVENT = 'gtha-open-support-tickets';

/** Fired to take somebody to the surface a lock lives on, which the page navigates to before opening its prompt. */
export const REVEAL_LOCK_EVENT = 'gtha-reveal-lock';

export const openUnlock = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_UNLOCK_EVENT, { detail: { target: id } }));
export const revealLock = (target: LockTarget) => window.dispatchEvent(new CustomEvent(REVEAL_LOCK_EVENT, { detail: { kind: target.kind, key: target.key } }));

const label = (target: LockTarget, t: Translate) => t(target.label.en, target.label.zh);

const minutesText = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function useTick(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [active, every]);
  return now;
}

/* ================================================================= gate == */

export type LockGateProps = {
  target: LockTarget;
  t: Translate;
  children: ReactNode;
  schoolOn?: boolean;
  /** A small bar for list rows, such as a saved trip. */
  compact?: boolean;
  /**
   * The surface does not open at all until it has a lock of its own. Used by the
   * mutation history, which the contract requires to be behind its own factor.
   */
  requireLock?: boolean;
};

/**
 * One lockable surface.
 *
 * While locked, its content is `inert` -- no pointer, keyboard, touch or
 * assistive-technology activation reaches it, and it cannot take focus -- and
 * the capture-phase handlers below refuse the programmatic route as well: a
 * `click()` dispatched at a control inside still passes through this element
 * first, is stopped here, and opens the unlock prompt instead. The content
 * stays visible, dimmed, so what is locked is never a mystery.
 *
 * The prompt opens inline, directly under the bar that names the lock, rather
 * than in a detached dialog, and focus returns to that bar when it closes.
 */
export function LockGate({ target, t, children, schoolOn = false, compact = false, requireLock = false }: LockGateProps) {
  const store = useToyLocks();
  const id = targetId(target);
  const lock = store.locks.find((item) => targetId(item.target) === id);
  const grant = lock ? store.grants[lock.id] : undefined;
  const now = useTick(Boolean(grant?.until), 1000);
  const locked = isLockedNow(lock, grant, now);
  const [prompt, setPrompt] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [menu, setMenu] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const domId = useId().replaceAll(':', '');
  const name = label(target, t);

  /* A surface-scoped grant ends when the surface goes away. */
  const lockId = lock?.id;
  useEffect(() => () => { if (lockId) releaseSurface(lockId); }, [lockId]);

  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent<{ target?: string }>).detail?.target !== id) return;
      if (lock) { setPrompt(true); } else { setWizard(true); }
      window.requestAnimationFrame(() => button.current?.focus());
    };
    window.addEventListener(OPEN_UNLOCK_EVENT, open);
    return () => window.removeEventListener(OPEN_UNLOCK_EVENT, open);
  }, [id, lock]);

  /** Every route into a locked surface lands here and opens the prompt instead. */
  const refuse = useCallback((event: SyntheticEvent) => {
    if (!locked) return;
    event.preventDefault();
    event.stopPropagation();
    setPrompt(true);
  }, [locked]);

  const returnFocus = () => window.requestAnimationFrame(() => button.current?.focus());

  const onContextMenu = (event: React.MouseEvent) => {
    /* Shift and right-click still belongs to the appearance editor. */
    if (event.shiftKey || event.defaultPrevented) return;
    event.preventDefault();
    setMenu(true);
  };

  const editAppearance = (element: HTMLElement | null) => {
    const ui = element?.closest<HTMLElement>('[data-ui]')?.dataset.ui;
    if (ui) window.dispatchEvent(new CustomEvent('gtha-edit-appearance', { detail: { id: ui } }));
  };
  const contextOrigin = useRef<HTMLElement | null>(null);

  const primary = locked
    ? <button ref={button} type="button" className="toy-lock__action" data-ui="lock.unlock" aria-expanded={prompt} aria-controls={`${domId}-prompt`} onClick={() => setPrompt((open) => !open)}><KeyRound size={18} aria-hidden="true" /><span>{t(`Unlock ${name}…`, `解鎖「${name}」…`)}</span></button>
    : lock
      ? <button ref={button} type="button" className="toy-lock__action" data-ui="lock.relock" onClick={() => relock(lock.id)}><Lock size={18} aria-hidden="true" /><span>{t(`Lock ${name} again`, `再鎖「${name}」`)}</span></button>
      : <button ref={button} type="button" className="toy-lock__action is-quiet" data-ui="lock.create" aria-expanded={wizard} aria-controls={`${domId}-wizard`} onClick={() => setWizard((open) => !open)}><Lock size={18} aria-hidden="true" /><span>{compact ? <span className="sr-only">{t(`Lock ${name}…`, `鎖住「${name}」…`)}</span> : t(`Lock ${name}…`, `鎖住「${name}」…`)}</span></button>;

  const needsLockFirst = requireLock && !lock;

  return (
    <div
      className={`toy-lock${locked ? ' is-locked' : ''}${compact ? ' is-compact' : ''}`}
      data-lock-target={id}
      onContextMenu={(event) => { contextOrigin.current = event.target as HTMLElement; onContextMenu(event); }}
    >
      <div className="toy-lock__bar" data-ui="lock.bar">
        {lock && (locked ? <Lock size={18} aria-hidden="true" /> : <LockOpen size={18} aria-hidden="true" />)}
        {lock && <span className="toy-lock__state">{locked ? t('Locked', '已鎖') : t('Unlocked for now', '暫時已解鎖')}</span>}
        {primary}
      </div>

      {menu && (
        <div className="toy-lock__menu" role="menu" aria-label={t(`Lock options for ${name}`, `「${name}」嘅鎖選項`)}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setMenu(false); returnFocus(); } }}>
          {locked
            ? <button type="button" role="menuitem" autoFocus onClick={() => { setMenu(false); setPrompt(true); }}>{t(`Unlock ${name}…`, `解鎖「${name}」…`)}</button>
            : lock
              ? <button type="button" role="menuitem" autoFocus onClick={() => { setMenu(false); relock(lock.id); returnFocus(); }}>{t(`Lock ${name} again`, `再鎖「${name}」`)}</button>
              : <button type="button" role="menuitem" autoFocus onClick={() => { setMenu(false); setWizard(true); }}>{t('Lock this element…', '鎖住呢個元素…')}</button>}
          <button type="button" role="menuitem" onClick={() => { setMenu(false); editAppearance(contextOrigin.current); }}>{t('Edit appearance…', '編輯外觀…')}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); returnFocus(); }}>{t('Cancel', '取消')}</button>
        </div>
      )}

      {prompt && lock && locked && (
        <UnlockPrompt id={`${domId}-prompt`} lock={lock} t={t} schoolOn={schoolOn} onClose={() => { setPrompt(false); returnFocus(); }} />
      )}
      {wizard && !lock && (
        <LockWizard id={`${domId}-wizard`} target={target} t={t} onClose={() => { setWizard(false); returnFocus(); }} />
      )}

      {needsLockFirst ? (
        <p className="toy-lock__needs">{t(`${name} opens only behind its own lock. Set one above first.`, `「${name}」要有自己嘅鎖先會打開，請先喺上面設定。`)}</p>
      ) : (
        <div
          className="toy-lock__content"
          inert={locked}
          aria-disabled={locked || undefined}
          onClickCapture={refuse}
          onPointerDownCapture={refuse}
          onKeyDownCapture={refuse}
          onInputCapture={refuse}
          onChangeCapture={refuse}
          onSubmitCapture={refuse}
          onDragStartCapture={refuse}
          onDropCapture={refuse}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ======================================================== unlock prompt == */

function UnlockPrompt({ id, lock, t, schoolOn, onClose }: { id: string; lock: LockRecord; t: Translate; schoolOn: boolean; onClose: () => void }) {
  const store = useToyLocks();
  const now = useTick(true, 1000);
  const [attempt, setAttempt] = useState<UnlockAttempt>(() => newAttempt(lock.id) as UnlockAttempt);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [ladder, setLadder] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /* Read through the store's own clock-aware reader; `store` above is what makes
     this re-render when an attempt is recorded anywhere. */
  const attempts = attemptsFor(lock.id, now);
  const factors = POLICY_FACTORS[lock.policy];
  const factor = factors[attempt.step] ?? factors[0];
  const waiting = attempts.waitUntil !== null && attempts.waitUntil > now;
  const offer = ladderAvailability(attempts, store.ladderSkips, now);
  const name = label(lock.target, t);
  const maxLength = factor === 'pin' ? PIN_MAX : factor === 'password' ? PASSWORD_MAX : (lock.totp?.digits ?? 6);

  const keys = useMemo(() => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    if (!shuffle) return digits;
    const random = globalThis.crypto.getRandomValues(new Uint32Array(digits.length));
    return digits.map((digit, index) => [random[index], digit] as const).sort((a, b) => a[0] - b[0]).map(([, digit]) => digit);
  }, [shuffle]);

  const submit = () => {
    if (!value) return;
    const result = submitFactor(lock.id, attempt, value);
    setValue('');
    setAttempt(result.attempt);
    const left = attemptsFor(lock.id).failures;
    setMessage({
      next: t(`That matched. Now the ${factorLabel(POLICY_FACTORS[lock.policy][result.attempt.step], t)}.`, `啱咗。跟住輸入${factorLabel(POLICY_FACTORS[lock.policy][result.attempt.step], t)}。`),
      unlocked: t(`${name} is unlocked.`, `「${name}」已解鎖。`),
      wrong: t(`That did not match. ${ATTEMPTS_PER_WAIT - left} tries left before a wait. Forgotten it? The way out is below.`, `唔啱。仲有 ${ATTEMPTS_PER_WAIT - left} 次機會，之後要等。唔記得？出路喺下面。`),
      waiting: t('That did not match, and now there is a wait before the next try.', '唔啱，下一次試之前要等一陣。'),
      expired: t('That took a while, so the steps start again from the first one.', '隔咗太耐，要由第一步重新開始。'),
    }[result.outcome]);
    if (result.outcome === 'unlocked') onClose();
    else window.requestAnimationFrame(() => field.current?.focus());
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <div id={id} className="toy-lock__prompt" role="group" aria-label={t(`Unlock ${name}`, `解鎖「${name}」`)} onKeyDown={onKey} data-ui="lock.prompt">
      <p className="toy-lock__steps">
        {t(`${policyLabel(lock.policy, t)}. Step ${attempt.step + 1} of ${factors.length}: ${factorLabel(factor, t)}.`, `${policyLabel(lock.policy, t)}。第 ${attempt.step + 1} 步，共 ${factors.length} 步：${factorLabel(factor, t)}。`)}
      </p>

      {waiting ? (
        <div className="toy-lock__wait">
          <p><Timer size={18} aria-hidden="true" /> <strong>{t(`Next try in ${minutesText(attempts.waitUntil! - now)}.`, `${minutesText(attempts.waitUntil! - now)} 之後可以再試。`)}</strong></p>
          <p>{t('Waiting clears nothing and deletes nothing. It just takes time.', '等唔會清除任何嘢，亦唔會刪除任何嘢，只係要啲時間。')}</p>
          {offer === 'offered' && !ladder && (
            <button type="button" className="toy-lock__action" data-ui="lock.ladder.start" onClick={() => setLadder(true)}>{t('Play instead of waiting', '唔想等，玩個遊戲')}</button>
          )}
          {offer === 'hourly-budget' && <p>{t('The games have skipped three waits in the last hour, so this one is the clock.', '過去一個鐘遊戲已經幫你跳過三次等候，今次要等時間過。')}</p>}
          {offer === 'spent-this-lockout' && <p>{t('The games have had their turn for this wait.', '今次等候已經玩過遊戲。')}</p>}
          {ladder && offer === 'offered' && (
            <UnlockLadder lockId={lock.id} t={t} schoolOn={schoolOn} onDone={(cleared) => { setLadder(false); setMessage(cleared ? t('The wait is over. You still need your PIN or password to open it.', '唔使再等。不過要開鎖，仲係要輸入 PIN 碼或者密碼。') : t('Out of games for this wait. The clock carries on.', '今次冇遊戲玩喇，繼續等時間過。')); }} />
          )}
        </div>
      ) : (
        <form className="toy-lock__entry" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label htmlFor={`${id}-value`}>{factorLabel(factor, t)}</label>
          <input
            ref={field}
            id={`${id}-value`}
            data-ui="lock.value"
            type={factor === 'password' || factor === 'pin' ? 'password' : 'text'}
            inputMode={factor === 'password' ? undefined : 'numeric'}
            autoComplete={factor === 'totp' ? 'one-time-code' : 'off'}
            autoFocus
            maxLength={maxLength}
            value={value}
            onChange={(event) => setValue(factor === 'password' ? event.target.value : event.target.value.replace(/\D/g, ''))}
          />
          {factor === 'pin' && (
            <fieldset className="toy-lock__keypad" data-ui="lock.keypad">
              <legend className="sr-only">{t('PIN keypad', 'PIN 碼鍵盤')}</legend>
              {keys.map((digit) => (
                <button key={digit} type="button" data-ui={`lock.keypad.${digit}`} onClick={() => setValue((current) => (current + digit).slice(0, PIN_MAX))}>{digit}</button>
              ))}
              <button type="button" data-ui="lock.keypad.backspace" onClick={() => setValue((current) => current.slice(0, -1))}>{t('Backspace', '刪除')}</button>
              <button type="button" data-ui="lock.keypad.clear" onClick={() => setValue('')}>{t('Clear', '清除')}</button>
            </fieldset>
          )}
          {factor === 'pin' && (
            <label className="toy-lock__check"><input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />{t('Shuffle the keypad', '打亂鍵盤次序')}</label>
          )}
          <div className="toy-lock__buttons">
            <button type="submit" className="toy-lock__action" data-ui="lock.submit" disabled={!value}>{attempt.step + 1 < factors.length ? t('Next', '下一步') : t('Unlock', '解鎖')}</button>
            <button type="button" className="toy-lock__action is-quiet" data-ui="lock.cancel" onClick={onClose}><X size={16} aria-hidden="true" />{t('Cancel', '取消')}</button>
          </div>
          <p className="toy-lock__hint">{t(`${Math.max(0, ATTEMPTS_PER_WAIT - attempts.failures)} tries before a wait. Pasting is allowed.`, `等候前仲有 ${Math.max(0, ATTEMPTS_PER_WAIT - attempts.failures)} 次機會。可以貼上。`)}</p>
        </form>
      )}

      {message && <output className="toy-lock__message" aria-live="polite">{message}</output>}

      <p className="toy-lock__disclosure">{t(LOCK_DISCLOSURE.en, LOCK_DISCLOSURE.zh)}</p>
      <p className="toy-lock__recovery">{t(LOCK_RECOVERY.en, LOCK_RECOVERY.zh)}</p>
      <button type="button" className="toy-lock__link" data-ui="lock.forgot" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TICKETS_EVENT))}>
        <Ticket size={16} aria-hidden="true" />{t('Forgotten your password? Open a support ticket', '唔記得密碼？開張服務單')}
      </button>
    </div>
  );
}

/* =============================================================== ladder == */

async function loadDishes(): Promise<LadderDish[]> {
  try {
    const response = await fetch(DIM_SUM_MANIFEST, { cache: 'force-cache' });
    if (!response.ok) return [];
    const manifest = parseManifest(await response.json());
    return manifest ? manifest.dishes.map((dish) => ({ id: dish.id, en: dish.en, zh: dish.zhHant, image: dishImage(dish) })) : [];
  } catch {
    return [];
  }
}

/**
 * One ladder per lockout, kept for as long as the page is open.
 *
 * Keyed by the lock and its lockout count rather than held in component state,
 * because closing and reopening the prompt must not hand out a fresh ladder: a
 * ladder that restarts at the dim sum rung, or re-deals a mole round somebody
 * was losing, every time its panel is toggled would be a ladder with no bottom.
 */
const ladders = new Map<string, { session: LadderSession; challenge: Challenge | null }>();

function UnlockLadder({ lockId, t, schoolOn, onDone }: { lockId: string; t: Translate; schoolOn: boolean; onDone: (cleared: boolean) => void }) {
  const key = `${lockId}:${attemptsFor(lockId).lockouts}`;
  const [challenge, setChallengeState] = useState<Challenge | null>(() => ladders.get(key)?.challenge ?? null);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState('');
  const translate = useRef(t);
  useEffect(() => { translate.current = t; }, [t]);

  const setChallenge = useCallback((next: Challenge | null) => {
    const entry = ladders.get(key);
    if (entry) entry.challenge = next;
    setChallengeState(next);
  }, [key]);

  useEffect(() => {
    if (ladders.has(key)) return;
    let cancelled = false;
    void (async () => {
      /* The dish pictures are this site's own files. Under School mode they are
         not even asked for, because the rung they belong to is absent. */
      const dishes = schoolOn ? [] : await loadDishes();
      if (cancelled || ladders.has(key)) return;
      try {
        const session = createLadderSession({ schoolOn, dishes });
        ladders.set(key, { session, challenge: null });
        setChallenge(session.begin(Date.now()));
      } catch {
        setFailed(translate.current('The games need a random number source this browser does not have. The wait carries on.', '遊戲需要隨機數，但呢個瀏覽器冇提供，所以要繼續等。'));
      }
    })();
    return () => { cancelled = true; };
  }, [key, schoolOn, setChallenge]);

  const answer = (value: unknown) => {
    const session = ladders.get(key)?.session;
    if (!session || !challenge) return;
    const result = session.submit(challenge.nonce, value, Date.now());
    if (result.outcome === 'cleared') { ladders.delete(key); ladderCleared(lockId); onDone(true); return; }
    if (result.rung === 'clock' || !result.challenge) { ladders.delete(key); ladderLost(lockId); onDone(false); return; }
    setStatus({
      wrong: t('Not that one. Another dish.', '唔係呢款，再嚟一款。'),
      fell: result.rung === 'sums' ? t('Five dishes missed. Ten easy sums instead, and every one must be right.', '錯咗五款點心。改做十條簡單數，要全部啱。') : t('One sum was off. Whack-a-mole next.', '有一條數錯咗。下一關打地鼠。'),
      expired: t('That question timed out. Here is a fresh one.', '條題目過咗時間，換過一條。'),
      'unknown-nonce': t('That answer was for an old question.', '呢個答案係答舊題目嘅。'),
      'too-early': '',
      cleared: '',
    }[result.outcome]);
    setChallenge(result.challenge);
  };

  if (failed) return <output className="toy-lock__message">{failed}</output>;
  if (!challenge) return <output className="toy-lock__message">{t('Setting up the games…', '準備緊遊戲…')}</output>;

  return (
    <section className="toy-ladder" aria-label={t('Games instead of waiting', '以遊戲代替等候')} data-ui="lock.ladder">
      <p className="toy-ladder__truth"><strong>{t('Winning ends the wait and nothing more. You will still need your PIN or password.', '贏咗只係唔使等，唔會幫你開鎖，仲要輸入 PIN 碼或者密碼。')}</strong></p>
      {status && <output aria-live="polite" className="toy-lock__message">{status}</output>}
      {challenge.rung === 'dim-sum' && (
        <div className="toy-ladder__dim-sum">
          <p>{t('Which dish is this?', '呢款係咩點心？')}</p>
          <img src={challenge.image} alt={t('A dim sum dish to name', '一款要你講出名嘅點心')} width={240} height={180} />
          <div className="toy-ladder__choices">
            {challenge.choices.map((choice) => (
              <button key={choice.id} type="button" data-ui="lock.ladder.choice" onClick={() => answer(choice.id)}>{t(choice.en, choice.zh)}</button>
            ))}
          </div>
          <button type="button" className="toy-lock__link" onClick={() => { const next = ladders.get(key)?.session.descend(Date.now()); if (next) { setStatus(''); setChallenge(next); } }}>
            {t('Cannot see the picture? Do the sums instead', '睇唔到張相？改做數')}
          </button>
        </div>
      )}
      {challenge.rung === 'sums' && <SumsRound key={challenge.nonce} challenge={challenge} t={t} onAnswer={answer} />}
      {challenge.rung === 'moles' && <MolesRound key={challenge.nonce} challenge={challenge} t={t} onAnswer={answer} />}
    </section>
  );
}

function SumsRound({ challenge, t, onAnswer }: { challenge: Extract<Challenge, { rung: 'sums' }>; t: Translate; onAnswer: (value: unknown) => void }) {
  const [answers, setAnswers] = useState<string[]>(() => challenge.problems.map(() => ''));
  const id = useId().replaceAll(':', '');
  return (
    <form className="toy-ladder__sums" onSubmit={(event) => { event.preventDefault(); onAnswer(answers.map((value) => (value.trim() === '' ? NaN : Number(value)))); }}>
      <p>{t('Ten sums. Every one must be right.', '十條數，要全部啱。')}</p>
      <ol>
        {challenge.problems.map((problem, index) => (
          <li key={index}>
            <label htmlFor={`${id}-${index}`}>{`${problem.left} ${problem.operator} ${problem.right} =`}</label>
            <input id={`${id}-${index}`} data-ui="lock.ladder.sum" inputMode="numeric" value={answers[index]} maxLength={4}
              onChange={(event) => setAnswers((current) => current.map((value, at) => (at === index ? event.target.value.replace(/[^\d-]/g, '') : value)))} />
          </li>
        ))}
      </ol>
      <button type="submit" className="toy-lock__action" data-ui="lock.ladder.sums.submit">{t('Check all ten', '對晒十條')}</button>
    </form>
  );
}

/**
 * Whack-a-mole, playable from the keyboard.
 *
 * The number keys 1 to 9 hit the matching cell, reading the grid like a phone
 * keypad, so nobody needs a mouse to get out of a wait. The score is announced
 * as it changes and the time left is written as a number, so neither depends on
 * colour or motion. Under reduced motion the moles appear without popping.
 */
function MolesRound({ challenge, t, onAnswer }: { challenge: Extract<Challenge, { rung: 'moles' }>; t: Translate; onAnswer: (value: unknown) => void }) {
  /* The round runs on the grader's clock, not this panel's, so closing and
     reopening the prompt continues the same round rather than starting over. */
  const started = challenge.issuedAt;
  const [elapsed, setElapsed] = useState(() => Date.now() - started);
  const hits = useRef<MoleHit[]>([]);
  const [score, setScore] = useState(0);
  const sent = useRef(false);
  const submit = useRef(onAnswer);
  useEffect(() => { submit.current = onAnswer; }, [onAnswer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const passed = Date.now() - started;
      setElapsed(passed);
      /* Sent only once the round has genuinely lasted its whole length. */
      if (passed >= challenge.durationMs + 50 && !sent.current) {
        sent.current = true;
        window.clearInterval(timer);
        submit.current(hits.current);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [challenge.durationMs, started]);

  const visible = challenge.moles.filter((mole) => elapsed >= mole.appearsAt && elapsed <= mole.appearsAt + mole.visibleMs);
  const whack = (cell: number) => {
    const at = Date.now() - started;
    const mole = challenge.moles.find((item) => item.cell === cell && at >= item.appearsAt && at <= item.appearsAt + item.visibleMs && !hits.current.some((hit) => hit.mole === item.index));
    if (!mole) return;
    hits.current = [...hits.current, { mole: mole.index, cell, at }];
    setScore(hits.current.length);
  };

  return (
    <div className="toy-ladder__moles" onKeyDown={(event) => { if (/^[1-9]$/.test(event.key)) { event.preventDefault(); whack(Number(event.key) - 1); } }}>
      <p>{t(`Hit ${challenge.needed} moles before the time is up. Keys 1 to 9 hit the cells.`, `時間完之前打中 ${challenge.needed} 隻地鼠。可以用 1 至 9 號鍵。`)}</p>
      <p className="toy-ladder__score">
        <output aria-live="polite">{t(`Hits: ${score} of ${challenge.needed}`, `打中：${score} / ${challenge.needed}`)}</output>
        {' · '}
        <span>{t(`${Math.max(0, Math.ceil((challenge.durationMs - elapsed) / 1000))} seconds left`, `仲有 ${Math.max(0, Math.ceil((challenge.durationMs - elapsed) / 1000))} 秒`)}</span>
      </p>
      <fieldset className="toy-ladder__grid">
        <legend className="sr-only">{t('Mole grid', '地鼠格')}</legend>
        {Array.from({ length: challenge.grid }, (_, cell) => {
          const up = visible.some((mole) => mole.cell === cell);
          return (
            <button key={cell} type="button" data-ui="lock.ladder.mole" className={up ? 'is-up' : ''} aria-label={up ? t(`Cell ${cell + 1}: mole`, `第 ${cell + 1} 格：有地鼠`) : t(`Cell ${cell + 1}: empty`, `第 ${cell + 1} 格：空`)} onClick={() => whack(cell)} autoFocus={cell === 4}>
              {up ? '●' : cell + 1}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

/* =============================================================== wizard == */

const ISSUER = 'GTHA Transit';

/**
 * Create a lock for one surface.
 *
 * Everything the lock needs is asked for here, in the order it will be asked for
 * again at the prompt, and nothing is created until every problem is resolved and
 * the person has ticked that this is a speed bump with a known way out.
 */
export function LockWizard({ id, target, t, onClose }: { id: string; target: LockTarget; t: Translate; onClose: () => void }) {
  const [policy, setPolicy] = useState<LockPolicy>('pin');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [secret, setSecret] = useState('');
  const [otp, setOtp] = useState<OtpParameters>({ ...DEFAULT_OTP });
  const [revealed, setRevealed] = useState(false);
  const [code, setCode] = useState('');
  const [durationKind, setDurationKind] = useState<UnlockDuration['kind']>('surface');
  const [minutes, setMinutes] = useState(15);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [notice, setNotice] = useState('');
  const factors = POLICY_FACTORS[policy];
  const name = label(target, t);

  useEffect(() => {
    if (!factors.includes('totp') || secret) return;
    try { setSecret(base32Encode(generateSecret())); }
    catch { setNotice(t('This browser has no secure random source, so an authenticator key cannot be made here. Choose a policy without a code.', '呢個瀏覽器冇安全隨機數，整唔到驗證器金鑰。請揀一個唔使驗證碼嘅方式。')); }
  }, [factors, secret, t]);

  const duration: UnlockDuration = durationKind === 'minutes' ? { kind: 'minutes', minutes } : { kind: durationKind };
  const uri = secret ? buildOtpauthUri({ issuer: ISSUER, account: target.label.en, secret, ...otp }) : '';

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNotice(t(`${what} copied.`, `已複製${what}。`)); }
    catch { setNotice(t('Copy is not available here. Select the text and copy it yourself.', '呢度用唔到複製，請自己揀選文字再複製。')); }
  };

  const create = () => {
    const draft = { target, policy, pin, pinConfirm, password, passwordConfirm, otpSecret: secret, otp, otpConfirmCode: code, duration, acknowledged };
    const found = draftProblems(draft, Math.floor(Date.now() / 1000));
    setProblems(found);
    if (found.length) return;
    try {
      addLock(draft);
      setPin(''); setPinConfirm(''); setPassword(''); setPasswordConfirm(''); setCode('');
      onClose();
    } catch {
      setNotice(t('The lock could not be created, and nothing was changed.', '整唔到把鎖，乜都冇改到。'));
    }
  };

  const problemText: Record<DraftProblem, string> = {
    target: t('There is nothing to lock here.', '呢度冇嘢可以鎖。'),
    'unknown-policy': t('Choose how it opens.', '揀點樣開鎖。'),
    'pin-unusable': t(`The PIN must be ${PIN_MIN} to ${PIN_MAX} digits.`, `PIN 碼要係 ${PIN_MIN} 至 ${PIN_MAX} 位數字。`),
    'pin-mismatch': t('The two PINs do not match.', '兩次輸入嘅 PIN 碼唔一樣。'),
    'password-unusable': t(`The password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, `密碼要有 ${PASSWORD_MIN} 至 ${PASSWORD_MAX} 個字元。`),
    'password-mismatch': t('The two passwords do not match.', '兩次輸入嘅密碼唔一樣。'),
    'otp-secret': t('There is no authenticator key yet.', '仲未有驗證器金鑰。'),
    'otp-parameters': t('The code settings are not valid.', '驗證碼設定唔啱。'),
    'otp-confirm': t('Type the current code from your authenticator app to confirm the pairing.', '請輸入驗證器 app 而家顯示嘅驗證碼，確認配對。'),
    duration: t(`Choose how long it stays open: 1 to ${MAX_UNLOCK_MINUTES} minutes.`, `揀開咗之後維持幾耐：1 至 ${MAX_UNLOCK_MINUTES} 分鐘。`),
    'not-acknowledged': t('Tick that you understand this is for fun and how to get out.', '請剔低你明白呢把鎖係玩下嘅，同埋點樣出返嚟。'),
  };

  return (
    <div id={id} className="toy-lock__wizard" role="group" aria-label={t(`Lock ${name}`, `鎖住「${name}」`)} data-ui="lock.wizard"
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
      <h4>{t(`Lock ${name}`, `鎖住「${name}」`)}</h4>

      <fieldset>
        <legend>{t('How it opens', '點樣開鎖')}</legend>
        {LOCK_POLICIES.map((option) => (
          <label key={option} className="toy-lock__choice">
            <input type="radio" name={`${id}-policy`} data-ui={`lock.policy.${option}`} checked={policy === option} onChange={() => { setPolicy(option); setProblems([]); }} />
            {policyLabel(option, t)}
          </label>
        ))}
      </fieldset>

      {factors.includes('pin') && (
        <div className="toy-lock__pair">
          <label htmlFor={`${id}-pin`}>{t(`PIN (${PIN_MIN} to ${PIN_MAX} digits)`, `PIN 碼（${PIN_MIN} 至 ${PIN_MAX} 位數字）`)}</label>
          <input id={`${id}-pin`} data-ui="lock.wizard.pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={PIN_MAX} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
          <label htmlFor={`${id}-pin2`}>{t('The same PIN again', '再輸入一次 PIN 碼')}</label>
          <input id={`${id}-pin2`} data-ui="lock.wizard.pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={PIN_MAX} value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, ''))} />
        </div>
      )}

      {factors.includes('password') && (
        <div className="toy-lock__pair">
          <label htmlFor={`${id}-password`}>{t(`Password (at least ${PASSWORD_MIN} characters)`, `密碼（最少 ${PASSWORD_MIN} 個字元）`)}</label>
          <input id={`${id}-password`} data-ui="lock.wizard.password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={password} onChange={(event) => setPassword(event.target.value)} />
          <label htmlFor={`${id}-password2`}>{t('The same password again', '再輸入一次密碼')}</label>
          <input id={`${id}-password2`} data-ui="lock.wizard.password-confirm" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} />
        </div>
      )}

      {factors.includes('totp') && secret && (
        <div className="toy-lock__otp">
          <p>{t('Pair an authenticator app. No QR code is drawn: this planner has no QR generator of its own, and it will not send your key to an online one. Add the key below by hand, or paste the link into an app that accepts it.', '配對驗證器 app。呢度唔會畫 QR code：規劃工具冇自己嘅 QR 產生器，亦唔會將你嘅金鑰交俾網上服務。請手動輸入下面嘅金鑰，或者將連結貼去支援嘅 app。')}</p>
          <p className="toy-lock__params">{t(`Algorithm ${otp.algorithm.toUpperCase()}, ${otp.digits} digits, every ${otp.period} seconds.`, `演算法 ${otp.algorithm.toUpperCase()}，${otp.digits} 位數字，每 ${otp.period} 秒轉一次。`)}</p>
          <label htmlFor={`${id}-algorithm`}>{t('Algorithm', '演算法')}</label>
          <select id={`${id}-algorithm`} value={otp.algorithm} onChange={(event) => { setOtp({ ...otp, algorithm: event.target.value as OtpParameters['algorithm'] }); setCode(''); }}>
            {OTP_ALGORITHMS.map((algorithm) => <option key={algorithm} value={algorithm}>{algorithm.toUpperCase()}</option>)}
          </select>
          {!revealed ? (
            <button type="button" className="toy-lock__action" data-ui="lock.wizard.reveal" onClick={() => setRevealed(true)}><Eye size={16} aria-hidden="true" />{t('Show the key', '顯示金鑰')}</button>
          ) : (
            <>
              <p className="toy-lock__secret" data-ui="lock.wizard.secret"><code>{groupSecret(secret)}</code></p>
              <div className="toy-lock__buttons">
                <button type="button" className="toy-lock__action is-quiet" onClick={() => void copy(secret, t('The key', '金鑰'))}><Copy size={16} aria-hidden="true" />{t('Copy key', '複製金鑰')}</button>
                <button type="button" className="toy-lock__action is-quiet" onClick={() => void copy(uri, t('The link', '連結'))}><Copy size={16} aria-hidden="true" />{t('Copy otpauth link', '複製 otpauth 連結')}</button>
              </div>
            </>
          )}
          <label htmlFor={`${id}-code`}>{t(`The ${otp.digits}-digit code your app shows now`, `你個 app 而家顯示嘅 ${otp.digits} 位驗證碼`)}</label>
          <input id={`${id}-code`} data-ui="lock.wizard.code" inputMode="numeric" autoComplete="one-time-code" maxLength={otp.digits} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
        </div>
      )}

      <fieldset>
        <legend>{t('Once opened, it stays open', '開咗之後維持')}</legend>
        <label className="toy-lock__choice"><input type="radio" name={`${id}-duration`} checked={durationKind === 'surface'} onChange={() => setDurationKind('surface')} />{t('Until you leave this page', '直至你離開呢頁')}</label>
        <label className="toy-lock__choice"><input type="radio" name={`${id}-duration`} checked={durationKind === 'minutes'} onChange={() => setDurationKind('minutes')} />{t('For a number of minutes', '維持若干分鐘')}</label>
        {durationKind === 'minutes' && (
          <label className="toy-lock__minutes">{t('Minutes', '分鐘')}<input type="number" min={1} max={MAX_UNLOCK_MINUTES} value={minutes} onChange={(event) => setMinutes(Math.round(Number(event.target.value)))} /></label>
        )}
        <label className="toy-lock__choice"><input type="radio" name={`${id}-duration`} checked={durationKind === 'session'} onChange={() => setDurationKind('session')} />{t('Until the planner is closed or reloaded', '直至關閉或者重新載入規劃工具')}</label>
      </fieldset>
      <p className="toy-lock__hint">{t('Every lock is locked again when the planner next opens.', '下次打開規劃工具，所有鎖都會重新鎖上。')}</p>

      <p className="toy-lock__disclosure">{t(LOCK_DISCLOSURE.en, LOCK_DISCLOSURE.zh)}</p>
      <p className="toy-lock__recovery">{t(LOCK_RECOVERY.en, LOCK_RECOVERY.zh)}</p>
      <label className="toy-lock__check">
        <input type="checkbox" data-ui="lock.wizard.acknowledge" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        {t('I understand this is for fun, and that clearing site data is the way out.', '我明白呢把鎖係玩下嘅，清除網站資料就可以出返嚟。')}
      </label>

      {problems.length > 0 && (
        <ul className="toy-lock__problems" aria-live="polite">{problems.map((problem) => <li key={problem}>{problemText[problem]}</li>)}</ul>
      )}
      {notice && <output className="toy-lock__message" aria-live="polite">{notice}</output>}

      <div className="toy-lock__buttons">
        <button type="button" className="toy-lock__action" data-ui="lock.wizard.create" onClick={create}><Lock size={16} aria-hidden="true" />{t(`Lock ${name}`, `鎖住「${name}」`)}</button>
        <button type="button" className="toy-lock__action is-quiet" data-ui="lock.wizard.cancel" onClick={onClose}>{t('Cancel', '取消')}</button>
      </div>
    </div>
  );
}
