/**
 * Drive the comfort modes and the wording file in the real built artifact.
 *
 * The unit suite proves the rules and asserts the wiring in the source. It cannot
 * prove that a switch reaches the shell, that focus actually dims anything, that
 * low stimulation actually stops an animation, or that a loaded wording file
 * changes a word a person can see. Those live in the seam between the component
 * and the browser, which is where this project's last three real defects were.
 *
 * It does not launch the browser. The endpoint is passed in, already proven to
 * expose exactly one page target at the expected URL.
 *
 * Usage:
 *   node scripts/ui-evidence/drive-comfort.mjs ws://127.0.0.1:PORT/devtools/page/ID
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
  await evaluate("[...document.querySelectorAll('.m3-nav__item, .m3-more__item')].find(b => /settings|設定/i.test(b.textContent||''))?.click()");
  await wait(900);
  await evaluate("[...document.querySelectorAll('[data-slot=\"tabs-trigger\"]')].find(b => /comfort|舒適/i.test(b.textContent||''))?.click()");
  await wait(700);
}

socket.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("!!document.querySelector('.m3-nav__item')")) break;
      await wait(250);
    }

    await openComfort();
    check('the comfort tab is reachable from the navigation',
      await evaluate("!!document.querySelector('.comfort-mode-list')"), true);

    check('all five modes are offered, and every one of them ships off',
      await evaluate("(() => { const i = [...document.querySelectorAll('.comfort-mode-list input[type=\"checkbox\"]')]; return { count: i.length, anyOn: i.some(x => x.checked) }; })()"),
      { count: 5, anyOn: false });

    check('each switch is a real switch to assistive technology',
      await evaluate("[...document.querySelectorAll('.comfort-mode-list input')].every(i => i.getAttribute('role') === 'switch')"), true);

    check('the mode rows meet the minimum target size',
      await evaluate("[...document.querySelectorAll('.comfort-mode-list label')].every(l => l.getBoundingClientRect().height >= 44)"), true);

    // --- focus ---------------------------------------------------------------
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[0].click()");
    await wait(500);
    check('turning focus on reaches the shell',
      await evaluate("document.querySelector('.shell').classList.contains('adhd-focus')"), true);
    check('and it dims rather than removing',
      await evaluate("(() => { const n = document.querySelector('.m3-nav__item:not(.is-active)'); const s = getComputedStyle(n); return { opacity: s.opacity, display: s.display }; })()"),
      { opacity: '0.45', display: 'flex' });
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[0].click()");
    await wait(400);
    check('turning it off puts everything back',
      await evaluate("getComputedStyle(document.querySelector('.m3-nav__item:not(.is-active)')).opacity"), '1');

    // --- low stimulation -----------------------------------------------------
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[1].click()");
    await wait(500);
    check('low stimulation stops motion rather than slowing it',
      await evaluate("(() => { const s = getComputedStyle(document.querySelector('.m3-nav__item')); return { animation: s.animationDuration, transition: s.transitionDuration }; })()"),
      { animation: '0s', transition: '0s' });
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[1].click()");
    await wait(400);

    // --- time awareness ------------------------------------------------------
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[2].click()");
    await wait(500);
    check('time awareness states a number',
      await evaluate("/\\d+ minutes/.test(document.querySelector('.comfort-clock')?.textContent || '')"), true);
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[2].click()");
    await wait(400);

    // --- one thing -----------------------------------------------------------
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[3].click()");
    await wait(500);
    check('one thing offers a field for the person to fill in themselves',
      await evaluate("!!document.querySelector('.comfort-one-thing input')"), true);
    await evaluate("(() => { const f = document.querySelector('.comfort-one-thing input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(f, 'Union to Kennedy'); f.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await wait(600);
    check('and what is typed rides on the shell, so it survives moving destination',
      await evaluate("document.querySelector('.shell').dataset.oneThing"), 'Union to Kennedy');
    await evaluate("document.querySelectorAll('.comfort-mode-list input')[3].click()");
    await wait(400);

    // --- the wording file ----------------------------------------------------
    check('the wording control is visible before any file exists',
      await evaluate("!!document.querySelector('.comfort-vocabulary-picker')"), true);
    check('and says plainly that nothing is loaded',
      await evaluate("/using its own wording/.test(document.querySelector('.comfort-vocabulary-state').textContent)"), true);
    check('the format panel ships the shape with nothing in it',
      await evaluate("(() => { const pre = document.querySelector('.comfort-vocabulary-format pre'); return pre ? /\"term\":\\s*\"\"/.test(pre.textContent) : 'no panel'; })()"), true);

    /*
     * A real file, through the real picker. DataTransfer is how a file reaches an
     * input without a native dialog; the component's own change handler does the
     * rest, so this exercises the path a person takes rather than a test-only hook.
     */
    const applied = await evaluate(`(() => {
      const input = document.querySelector('.comfort-vocabulary-control input[type="file"]');
      if (!input) return 'no input';
      const text = JSON.stringify({ version: 1, entries: [{ term: 'Settings', replacement: 'Knobs' }] });
      const file = new File([text], 'words.json', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    check('a file can be handed to the real picker', applied, true);
    await wait(1200);

    check('the loaded file is reported by its entry count',
      await evaluate("/1 of your words|已套用你 1/.test(document.querySelector('.comfort-vocabulary-state').textContent)"), true);
    check('and the word it renames actually changes on screen',
      await evaluate("[...document.querySelectorAll('.m3-nav__label')].some(n => n.textContent.trim() === 'Knobs')"), true);
    check('while a route number is left alone, because it is not a word of ours to rename',
      await evaluate("document.body.textContent.includes('GREATER TORONTO')"), true);

    await evaluate("[...document.querySelectorAll('.comfort-vocabulary-control button')].find(b => /Clear/.test(b.textContent))?.click()");
    await wait(900);
    check('clearing restores the original wording immediately',
      await evaluate("[...document.querySelectorAll('.m3-nav__label')].some(n => n.textContent.trim() === 'Settings')"), true);

    // A file the reader refuses must apply nothing and say why.
    const refused = await evaluate(`(() => {
      const input = document.querySelector('.comfort-vocabulary-control input[type="file"]');
      const text = JSON.stringify({ version: 9, entries: [] });
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'old.json', { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    check('a refused file is handed over', refused, true);
    await wait(1000);
    check('a refused file is refused in words, and applies nothing',
      await evaluate("(() => { const s = document.querySelector('.comfort-vocabulary-state').textContent; return { said: /version 1 files|第 1 版/.test(s), stillOurs: [...document.querySelectorAll('.m3-nav__label')].some(n => n.textContent.trim() === 'Settings') }; })()"),
      { said: true, stillOurs: true });

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
