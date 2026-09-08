/**
 * Drive School mode in the real built artifact.
 *
 * The unit suite proves the lock, the suppression list and the wiring in the
 * source. What it cannot prove is the thing the whole feature is about: that the
 * controls actually LEAVE the interface. A guard reading `components/*.tsx` sees
 * a conditional; only a browser can say whether the language buttons are gone
 * from the rail, whether the Language tab is gone from the strip, and whether the
 * palette can still teleport to a setting that is supposed to have disappeared.
 *
 * It does not launch the browser. The endpoint is passed in, already proven to
 * expose exactly one page target at the expected URL.
 *
 * Usage:
 *   node scripts/ui-evidence/drive-school-mode.mjs ws://127.0.0.1:PORT/devtools/page/ID
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' :: ' + expression);
  return result.result.value;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
};

/** Reach the comfort tab the way a person does: the navigation, then the tab. */
async function openComfort() {
  await evaluate("[...document.querySelectorAll('.m3-nav__item, .m3-more__item')].find(b => /settings|設定|knobs/i.test(b.textContent||''))?.click()");
  await wait(900);
  await evaluate("[...document.querySelectorAll('[data-slot=\"tabs-trigger\"]')].find(b => /comfort|舒適/i.test(b.textContent||''))?.click()");
  await wait(700);
}

/** Type into a controlled React input the way a person's keystroke would. */
const type = (selector, value) => `(() => {
  const field = document.querySelector(${JSON.stringify(selector)});
  if (!field) return 'no field';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(field, ${JSON.stringify(value)});
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

/*
 * What the palette can currently find for a query, by label.
 *
 * Done in steps rather than as one async expression, because Runtime.evaluate
 * without awaitPromise returns the Promise itself -- which arrives as {} and
 * compares unequal to everything, so every check built on it fails for a reason
 * that has nothing to do with the interface. awaitPromise is not the fix: it
 * hangs on this Node.
 */
async function paletteFinds(query) {
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true }))");
  await wait(700);
  const opened = await evaluate("!!document.querySelector('.palette input[type=\"search\"]')");
  if (!opened) return 'the palette did not open';
  await evaluate(type('.palette input[type="search"]', query));
  await wait(700);
  const rows = await evaluate("[...document.querySelectorAll('.palette__row, .palette__result, .palette li button')].map(r => r.textContent.trim())");
  await evaluate("document.querySelector('.palette')?.close?.(); true");
  await wait(400);
  return rows;
}

socket.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("!!document.querySelector('.m3-nav__item')")) break;
      await wait(250);
    }

    /* Start from nothing. A previous run's lock in this profile would make every
       "it is hidden" check pass for the wrong reason. */
    await evaluate("localStorage.removeItem('gtha-school-mode-v1'); true");
    await send('Page.reload');
    await wait(2500);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("!!document.querySelector('.m3-nav__item')")) break;
      await wait(250);
    }

    // --- before: everything it will hide is actually there ---------------------
    check('the language buttons are in the rail to begin with',
      await evaluate("document.querySelectorAll('.m3-nav__langs .m3-nav__lang').length"), 3);

    await openComfort();
    check('the comfort tab is reachable',
      await evaluate("!!document.querySelector('.comfort-mode-list')"), true);
    check('the wording card is there to begin with',
      await evaluate("!!document.querySelector('.comfort-vocabulary-picker')"), true);
    check('the Language tab is in the strip to begin with',
      await evaluate("[...document.querySelectorAll('[data-slot=\"tabs-trigger\"]')].some(b => /language|語言/i.test(b.textContent||''))"), true);
    check('the mode control is on the comfort tab, off, under its shipped name',
      await evaluate("(() => { const card = document.querySelector('.school-mode'); return card ? { name: card.querySelector('h3').textContent.trim(), on: !!card.querySelector('.school-mode__on') } : 'no card'; })()"),
      { name: 'School mode', on: false });

    // The palette can reach a control that is about to disappear.
    const beforeRows = await paletteFinds('playfulness');
    check('the palette finds the playfulness sliders before the mode is on',
      Array.isArray(beforeRows) && beforeRows.some((row) => /playfulness/i.test(row)), true);

    // --- turning it on -------------------------------------------------------
    await openComfort();
    check('the lock can actually be made here, or the rest of this proves nothing',
      await evaluate("typeof crypto.subtle"), 'object');

    await evaluate(type('.school-mode input[type="password"]', 'ab'));
    await wait(400);
    check('a short word is refused rather than silently accepted',
      await evaluate("document.querySelector('.school-mode button').disabled"), true);

    await evaluate(type('.school-mode input[type="text"]', 'Exam mode'));
    await wait(300);
    await evaluate(type('.school-mode input[type="password"]', 'exam-time'));
    await wait(400);
    check('a usable word enables the button',
      await evaluate("document.querySelector('.school-mode button').disabled"), false);

    await evaluate("document.querySelector('.school-mode button').click()");
    await wait(1500);

    // --- after: it is omitted, not disabled ----------------------------------
    check('the language buttons are GONE from the rail, not disabled',
      await evaluate("(() => { const all = [...document.querySelectorAll('.m3-nav__lang')]; return { count: all.length, disabled: all.filter(b => b.disabled).length }; })()"),
      { count: 0, disabled: 0 });

    check('the Language tab is gone from the strip',
      await evaluate("[...document.querySelectorAll('[data-slot=\"tabs-trigger\"]')].some(b => /language|語言/i.test(b.textContent||''))"), false);

    check('the wording card is gone from the comfort tab',
      await evaluate("!!document.querySelector('.comfort-vocabulary-picker')"), false);

    check('and nothing anywhere is left greyed out announcing what went',
      await evaluate("[...document.querySelectorAll('button, input, select')].filter(e => e.disabled && /cantonese|廣東話|playfulness|趣味|wording|用語/i.test((e.textContent || '') + (e.getAttribute('aria-label') || ''))).length"), 0);

    check('the planner reads in English whatever was chosen',
      await evaluate("document.documentElement.lang"), 'en');

    check('the chosen name is on the control, and the shipped one is nowhere on the page',
      await evaluate("(() => { const card = document.querySelector('.school-mode'); return { name: card.querySelector('h3').textContent.trim(), shippedAnywhere: document.body.textContent.includes('School mode') }; })()"),
      { name: 'Exam mode', shippedAnywhere: false });

    check('the way out stays on the control, in words, with what it costs',
      await evaluate("(() => { const t = document.querySelector('.school-mode__honesty')?.textContent || ''; return { speedBump: /speed bump, not a lock on your data/.test(t), route: /Clearing this site/.test(t), cost: /also clears your saved trips/.test(t) }; })()"),
      { speedBump: true, route: true, cost: true });

    // The palette is the teleport this feature would otherwise leave open.
    const hidden = await paletteFinds('playfulness');
    check('the palette can no longer reach a suppressed setting',
      Array.isArray(hidden) ? hidden.filter(row => /playfulness|趣味/i.test(row)).length : hidden, 0);

    const findable = await paletteFinds('Exam');
    check('but the mode itself is still findable, under its chosen name',
      Array.isArray(findable) ? findable.some(row => /Exam mode/.test(row)) : findable, true);

    // --- it survives a reload ------------------------------------------------
    await send('Page.reload');
    await wait(2500);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("!!document.querySelector('.m3-nav__item')")) break;
      await wait(250);
    }
    check('the mode is still on after a reload, and the rail is still without them',
      await evaluate("document.querySelectorAll('.m3-nav__lang').length"), 0);

    // --- the wrong word, then the right one ----------------------------------
    await openComfort();
    await evaluate(type('.school-mode input[type="password"]', 'not-it'));
    await wait(300);
    await evaluate("[...document.querySelectorAll('.school-mode button')].find(b => /Turn off/.test(b.textContent))?.click()");
    await wait(1500);
    check('a wrong word says so and changes nothing',
      await evaluate("(() => ({ said: !!document.querySelector('.school-mode__wrong'), stillOn: document.querySelectorAll('.m3-nav__lang').length === 0 }))()"),
      { said: true, stillOn: true });

    await evaluate(type('.school-mode input[type="password"]', 'exam-time'));
    await wait(300);
    await evaluate("[...document.querySelectorAll('.school-mode button')].find(b => /Turn off/.test(b.textContent))?.click()");
    await wait(1800);

    check('the right word gives everything back',
      await evaluate("(() => ({ langs: document.querySelectorAll('.m3-nav__lang').length, tab: [...document.querySelectorAll('[data-slot=\"tabs-trigger\"]')].some(b => /language|語言/i.test(b.textContent||'')), wording: !!document.querySelector('.comfort-vocabulary-picker') }))()"),
      { langs: 3, tab: true, wording: true });

    check('and the name they chose is still theirs afterwards',
      await evaluate("document.querySelector('.school-mode h3').textContent.trim()"), 'Exam mode');

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
