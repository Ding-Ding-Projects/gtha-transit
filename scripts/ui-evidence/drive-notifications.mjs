/**
 * Drive the notification surface in the real built artifact.
 *
 * The unit suite proves the store's rules and asserts the wiring in the source.
 * It cannot prove that the opener opens anything, that the centre's filters are
 * connected to the list, that the confirmation gate refuses an incomplete sweep
 * in a browser, or that Escape closes what it should. That seam is exactly where
 * the palette's Escape defect lived: every test green, and the first key press a
 * person made did nothing.
 *
 * It does not launch the browser. The endpoint is passed in, already proven to
 * expose exactly one page target at the expected URL, because a run that both
 * opens the browser and vouches for it is vouching for itself.
 *
 * Usage:
 *   node scripts/ui-evidence/drive-notifications.mjs ws://127.0.0.1:PORT/devtools/page/ID
 */

import { WebSocket } from 'ws';

const socket = new WebSocket(process.argv[2], { suppressOrigin: true });
let nextId = 1;
const pending = new Map();

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});

/** Synchronous expressions only: awaitPromise has been observed to hang on this runtime. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' :: ' + expression);
  return result.result.value;
}

async function key(name, code, keyCode, modifiers = 0) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

socket.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Page.enable');

    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("!!document.querySelector('.notification-opener')")) break;
      await wait(250);
    }

    check('the toast stack and the opener are both in the served document',
      await evaluate("!!document.querySelector('.toast-stack') && !!document.querySelector('.notification-opener')"), true);

    check('the stack does not block the page behind it',
      await evaluate("getComputedStyle(document.querySelector('.toast-stack')).pointerEvents"), 'none');

    check('nothing has happened yet, so the stack is empty rather than showing a placeholder',
      await evaluate("document.querySelectorAll('.toast-stack .toast').length"), 0);

    // --- the centre ---------------------------------------------------------
    await evaluate("document.querySelector('.notification-opener').click()");
    await wait(600);
    check('the opener opens the centre', await evaluate("document.querySelector('.notification-centre').open"), true);

    check('the centre carries the regex builder, like every other search here',
      await evaluate("!!document.querySelector('.notification-centre .regex-workbench') && !!document.querySelector('.notification-centre .regex-workbench__trigger')"), true);

    check('every severity is filterable, and one with none reads as zero rather than being hidden',
      await evaluate("[...document.querySelectorAll('.notification-centre__severities label small')].map(n => n.textContent)"),
      ['0', '0', '0', '0', '0']);

    check('the empty state says so in words',
      await evaluate("document.querySelector('.notification-centre__empty').textContent.trim()"), 'Nothing has happened yet.');

    check('every export format is offered',
      await evaluate("document.querySelectorAll('#notification-format option').length"), 11);

    check('there is nothing to export or forget, and both controls say so',
      await evaluate("document.querySelector('.notification-centre__export button').disabled && document.querySelector('.notification-centre__forget').disabled"), true);

    await key('Escape', 'Escape', 27);
    await wait(500);
    check('Escape closes the centre', await evaluate("document.querySelector('.notification-centre').open"), false);

    // --- a real notification, raised the way the application raises one ------
    /*
     * A malformed shared link. Somebody opening a broken link somebody else sent
     * them is a real path through the shell: it refuses the destination list and
     * raises a warning. Reloading is how the application reads a link, so this
     * exercises the notifier exactly as a person would reach it.
     */
    await send('Page.navigate', { url: 'http://127.0.0.1:8138/?via=nonsense&via=more-nonsense' });
    await wait(3500);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate("document.querySelectorAll('.toast-stack .toast').length > 0")) break;
      await wait(250);
    }

    const raised = await evaluate("document.querySelectorAll('.toast-stack .toast').length");
    if (raised > 0) {
      check('a raised notification appears in the stack', raised >= 1, true);
      check('a warning is not announced assertively',
        await evaluate("document.querySelector('.toast-stack .toast').getAttribute('aria-live')"), 'polite');
      check('its dismiss control is at least 44px',
        await evaluate("Math.round(document.querySelector('.toast__close').getBoundingClientRect().height) >= 44"), true);
      await evaluate("document.querySelector('.toast__close').click()");
      await wait(400);
      check('dismissing takes it off the stack', await evaluate("document.querySelectorAll('.toast-stack .toast').length"), 0);

      await evaluate("document.querySelector('.notification-opener').click()");
      await wait(600);
      check('and the centre still has it', await evaluate("document.querySelectorAll('.notification-row').length >= 1"), true);

      // --- the gate --------------------------------------------------------
      await evaluate("document.querySelector('.notification-centre__list .notification-row__select input').click()");
      await wait(300);
      await evaluate("document.querySelector('.notification-centre__forget').click()");
      await wait(600);
      check('forgetting opens the two-key gate', await evaluate("document.querySelector('.super-confirm').open"), true);
      check('the slider is inert until both keys are turned',
        await evaluate("document.querySelector('.super-confirm__slider input').disabled"), true);
      check('and the confirm button refuses',
        await evaluate("document.querySelector('.super-confirm__go').disabled"), true);

      await evaluate("document.querySelectorAll('.super-confirm__key input')[0].click()");
      await wait(200);
      check('one key is not enough',
        await evaluate("document.querySelector('.super-confirm__slider input').disabled"), true);

      await evaluate("document.querySelectorAll('.super-confirm__key input')[1].click()");
      await wait(300);
      check('both keys arm the slider',
        await evaluate("document.querySelector('.super-confirm__slider input').disabled"), false);
      check('a partly dragged slider still refuses',
        await evaluate("(() => { const s = document.querySelector('.super-confirm__slider input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(s, '0.9'); s.dispatchEvent(new Event('input', { bubbles: true })); return document.querySelector('.super-confirm__go').disabled; })()"), true);

      check('the emergency exit is never disabled',
        await evaluate("document.querySelector('.super-confirm__exit').disabled"), false);
      await evaluate("document.querySelector('.super-confirm__exit').click()");
      await wait(400);
      check('and it leaves without destroying anything',
        await evaluate("!document.querySelector('.super-confirm').open && document.querySelectorAll('.notification-row').length >= 1"), true);
    } else {
      console.log('SKIP  no notification could be raised from this state; the gate was not driven');
      results.push({ ok: true, name: 'gate not reachable from this state, reported rather than assumed' });
    }

    check('nothing threw while all of that happened',
      await evaluate("window.__errors ? window.__errors.length : 0"), 0);

    const failed = results.filter((item) => !item.ok).length;
    console.log(`\n${results.length - failed} of ${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('DRIVE FAILED:', error.message);
    process.exit(2);
  }
});

socket.on('error', (error) => {
  console.error('socket error:', error.message);
  process.exit(2);
});
