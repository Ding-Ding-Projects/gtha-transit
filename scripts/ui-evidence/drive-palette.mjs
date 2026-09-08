/**
 * Drive the command palette in the real built artifact.
 *
 * The unit suite proves the palette's logic and asserts its wiring in the source.
 * It cannot prove that a key press opens the dialog, that the search field is the
 * one the palette focuses, or that a teleport lands on anything. That seam is
 * exactly the one a stubbed test is blind to, so this presses real keys through
 * the debugging protocol against the document the server actually serves.
 *
 * It earned its place on the first run. Fourteen of fifteen checks passed and the
 * fifteenth found a defect nothing else could have: Escape did not close the
 * palette, because the palette focuses a search field on open and Chromium treats
 * Escape there as "clear this field" and consumes the key. Every unit test was
 * green, the source read correctly, and the very first Escape anybody pressed did
 * nothing.
 *
 * It does not launch the browser. The endpoint is passed in, already proven to
 * expose exactly one page target at the expected URL, because a run that both
 * opens the browser and vouches for it is vouching for itself.
 *
 * Usage:
 *   node scripts/ui-evidence/drive-palette.mjs ws://127.0.0.1:PORT/devtools/page/ID
 */

import { WebSocket } from 'ws';

const ENDPOINT = process.argv[2];
const socket = new WebSocket(ENDPOINT, { suppressOrigin: true });

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

const CTRL = 2, SHIFT = 8;

async function chord(key, code, keyCode, modifiers) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers,
    });
  }
}

async function typeText(text) {
  for (const character of text) {
    await send('Input.insertText', { text: character });
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const check = (name, actual, expected, note = '') => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, name, actual, expected, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

socket.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Page.enable');

    // Wait for hydration: the shortcut listener is registered by an effect, so a
    // key press against the prerendered document alone would prove nothing.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ready = await evaluate("!!document.querySelector('dialog.palette') && !!document.querySelector('.m3-nav__item')");
      if (ready) break;
      await wait(250);
    }

    check('the palette exists in the served document and starts closed',
      await evaluate("(() => { const d = document.querySelector('dialog.palette'); return d ? d.open : 'no dialog'; })()"),
      false);

    // --- the shortcut -------------------------------------------------------
    await evaluate("document.body.focus()");
    await chord('F', 'KeyF', 70, CTRL | SHIFT);
    await wait(400);

    check('Ctrl+Shift+F opens it',
      await evaluate("document.querySelector('dialog.palette').open"), true);

    check('the focus lands in the search field, not on the dialog',
      await evaluate("document.activeElement && document.activeElement.type"), 'search');

    check('it opens showing everything it can reach',
      await evaluate("document.querySelectorAll('.palette-row').length"), 27,
      'nine destinations, fifteen settings, three actions');

    check('a settings row renders its real control inline',
      await evaluate("!!document.querySelector('.palette-row__choices input[type=\"radio\"]') && !!document.querySelector('.palette-row__control input[type=\"range\"]') && !!document.querySelector('.palette-row__control input[type=\"checkbox\"]')"),
      true);

    // --- searching ----------------------------------------------------------
    await typeText('dark mode');
    await wait(600);
    check('searching a word the interface never shows finds the colour theme',
      await evaluate("[...document.querySelectorAll('.palette-row__text strong')].map(n => n.textContent)"),
      ['Colour theme']);

    // --- a live control, changing the real value ----------------------------
    const themeBefore = await evaluate("document.documentElement.getAttribute('data-theme')");
    await evaluate("document.querySelector('.palette-row__choices input[type=\"radio\"]:not(:checked)').click()");
    await wait(500);
    const themeAfter = await evaluate("document.documentElement.getAttribute('data-theme')");
    check('changing the control in the palette changes the real theme',
      themeBefore !== themeAfter && !!themeAfter, true, `${themeBefore} -> ${themeAfter}`);

    // Put it back, so the teleport check below is not confounded by a theme change.
    await evaluate("document.querySelector('.palette-row__choices input[type=\"radio\"]:not(:checked)').click()");
    await wait(400);

    // --- the teleport -------------------------------------------------------
    check('the workspace is not on settings before the teleport',
      await evaluate("document.querySelector('.shell').dataset.tab !== 'settings'"), true);

    await evaluate("document.querySelector('.palette-row__go').click()");
    await wait(1200);

    check('choosing the row closes the palette',
      await evaluate("document.querySelector('dialog.palette').open"), false);

    check('and moves the workspace to the settings destination',
      await evaluate("document.querySelector('.shell').dataset.tab"), 'settings');

    check('the focus is on the control itself, not the page holding it',
      await evaluate("document.activeElement && document.activeElement.id"), 'settings-theme-light');

    check('and the control it landed on is outlined',
      await evaluate("document.activeElement.classList.contains('palette-landed')"), true);

    // --- escape and focus return -------------------------------------------
    await chord('F', 'KeyF', 70, CTRL | SHIFT);
    await wait(400);
    check('the shortcut opens it again from another destination',
      await evaluate("document.querySelector('dialog.palette').open"), true);

    await chord('Escape', 'Escape', 27, 0);
    await wait(400);
    check('Escape closes it',
      await evaluate("document.querySelector('dialog.palette').open"), false);

    // --- the console --------------------------------------------------------
    check('nothing threw while all of that happened',
      await evaluate("window.__paletteErrors ? window.__paletteErrors.length : 0"), 0);

    const failed = results.filter((r) => !r.ok).length;
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
