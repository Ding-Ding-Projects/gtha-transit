import assert from 'node:assert/strict';
import test from 'node:test';

import { close, createGroup, createStripState, pin } from '../lib/tabs.ts';
import { allStrips, registerStrip, searchAllTabs, unregisterStrip } from '../lib/tab-registry.ts';

const descriptor = (id, label) => ({ id, label: label ?? id });

/**
 * Registers a strip only for the duration of `run`, unregistering even when
 * `run` throws. `tab-registry.ts` is the one piece of module-level mutable
 * state in this pair of files, and its own doc comment asks every test file
 * to clean up after itself since tests within one file share that instance;
 * a plain `unregisterStrip` after a failed assertion would never run, so the
 * cleanup goes in `finally` rather than at the end of the test body.
 */
function withStrip(surface, snapshot, run) {
  registerStrip(surface, () => snapshot);
  try {
    return run();
  } finally {
    unregisterStrip(surface);
  }
}

/* ------------------------------------------------------ register/unregister -- */

test('registerStrip adds a surface to allStrips; unregisterStrip removes it', () => {
  unregisterStrip('registry-basic-test');
  assert.equal(allStrips().includes('registry-basic-test'), false, 'not registered yet');
  registerStrip('registry-basic-test', () => ({ tabs: [], state: createStripState('registry-basic-test', []) }));
  assert.equal(allStrips().includes('registry-basic-test'), true);
  unregisterStrip('registry-basic-test');
  assert.equal(allStrips().includes('registry-basic-test'), false, 'removed');
});

test('unregisterStrip on a surface that was never registered is a no-op, not a throw', () => {
  assert.doesNotThrow(() => unregisterStrip('surface-never-registered'));
  assert.equal(allStrips().includes('surface-never-registered'), false);
});

/* -------------------------------------------------------------- allStrips() -- */

test('allStrips reflects registration order, and re-registering an existing surface does not move it', () => {
  const surfaces = ['order-a-test', 'order-b-test', 'order-c-test'];
  for (const surface of surfaces) unregisterStrip(surface);
  try {
    for (const surface of surfaces) {
      registerStrip(surface, () => ({ tabs: [], state: createStripState(surface, []) }));
    }
    assert.deepEqual(allStrips().filter((surface) => surfaces.includes(surface)), surfaces);

    // Re-registering the first surface replaces its getter (checked below) but
    // must not reorder it to the back of the list: a Map keeps a key's original
    // iteration position when the key is set again, and allStrips relies on that.
    registerStrip('order-a-test', () => ({ tabs: [], state: createStripState('order-a-test', []) }));
    assert.deepEqual(
      allStrips().filter((surface) => surfaces.includes(surface)),
      surfaces,
      're-registering keeps the surface at its original position',
    );
  } finally {
    for (const surface of surfaces) unregisterStrip(surface);
  }
});

/* ------------------------------------------------------------ searchAllTabs -- */

test('searchAllTabs reports surface, id, label, group, pinned and closed for every matching tab across two strips', () => {
  let tripsState = createStripState('trips-search-test', ['plan', 'status', 'saved']);
  tripsState = pin(tripsState, 'plan');
  tripsState = createGroup(tripsState, { id: 'recent', name: 'Recent', members: ['status'] });
  const tripsTabs = [descriptor('plan', 'Plan a trip'), descriptor('status', 'Live status'), descriptor('saved', 'Saved trips')];

  let settingsState = createStripState('settings-search-test', ['appearance', 'language']);
  settingsState = close(settingsState, 'language');
  const settingsTabs = [descriptor('appearance', 'Appearance'), descriptor('language', 'Language')];

  registerStrip('trips-search-test', () => ({ tabs: tripsTabs, state: tripsState }));
  registerStrip('settings-search-test', () => ({ tabs: settingsTabs, state: settingsState }));
  try {
    const results = searchAllTabs(() => true).filter((result) =>
      result.surface === 'trips-search-test' || result.surface === 'settings-search-test',
    );
    const find = (surface, id) => results.find((result) => result.surface === surface && result.id === id);

    assert.deepEqual(
      find('trips-search-test', 'plan'),
      { surface: 'trips-search-test', id: 'plan', label: 'Plan a trip', group: null, pinned: true, closed: false },
      'pinned and ungrouped',
    );
    assert.deepEqual(
      find('trips-search-test', 'status'),
      { surface: 'trips-search-test', id: 'status', label: 'Live status', group: 'recent', pinned: false, closed: false },
      'grouped tab carries its group id',
    );
    assert.deepEqual(
      find('trips-search-test', 'saved'),
      { surface: 'trips-search-test', id: 'saved', label: 'Saved trips', group: null, pinned: false, closed: false },
    );
    assert.deepEqual(
      find('settings-search-test', 'appearance'),
      { surface: 'settings-search-test', id: 'appearance', label: 'Appearance', group: null, pinned: false, closed: false },
    );
    assert.deepEqual(
      find('settings-search-test', 'language'),
      { surface: 'settings-search-test', id: 'language', label: 'Language', group: null, pinned: false, closed: true },
      'closed tab carries closed: true and is still returned, not hidden',
    );
    assert.equal(results.length, 5, 'exactly the five tabs across both strips, nothing extra and nothing missing');
  } finally {
    unregisterStrip('trips-search-test');
    unregisterStrip('settings-search-test');
  }
});

test('searchAllTabs takes a plain function matcher and applies it to every registered strip', () => {
  const tripsTabs = [descriptor('plan', 'Plan a trip'), descriptor('status', 'Live status'), descriptor('saved', 'Saved trips')];
  const settingsTabs = [descriptor('appearance', 'Appearance'), descriptor('language', 'Language')];
  withStrip('trips-matcher-test', { tabs: tripsTabs, state: createStripState('trips-matcher-test', tripsTabs.map((tab) => tab.id)) }, () => {
    withStrip(
      'settings-matcher-test',
      { tabs: settingsTabs, state: createStripState('settings-matcher-test', settingsTabs.map((tab) => tab.id)) },
      () => {
        const matchesTrip = (label) => label.toLowerCase().includes('trip');
        assert.equal(typeof matchesTrip, 'function', 'the matcher searchAllTabs takes is a plain function of a label');

        const results = searchAllTabs(matchesTrip).filter(
          (result) => result.surface === 'trips-matcher-test' || result.surface === 'settings-matcher-test',
        );
        assert.deepEqual(
          results.map((result) => `${result.surface}/${result.id}`).sort(),
          ['trips-matcher-test/plan', 'trips-matcher-test/saved'],
          'only the two labels containing "trip" match, and settings-matcher-test contributes nothing',
        );

        const matchesNothing = () => false;
        assert.deepEqual(
          searchAllTabs(matchesNothing).filter(
            (result) => result.surface === 'trips-matcher-test' || result.surface === 'settings-matcher-test',
          ),
          [],
          'a matcher that accepts nothing returns nothing, from either strip',
        );
      },
    );
  });
});

test('unregistering a strip removes its tabs from every later search', () => {
  const tabs = [descriptor('a', 'Alpha'), descriptor('b', 'Beta')];
  registerStrip('unregister-search-test', () => ({ tabs, state: createStripState('unregister-search-test', ['a', 'b']) }));
  try {
    const before = searchAllTabs(() => true).filter((result) => result.surface === 'unregister-search-test');
    assert.equal(before.length, 2, 'both tabs show up while the strip is registered');
  } finally {
    unregisterStrip('unregister-search-test');
  }
  const after = searchAllTabs(() => true).filter((result) => result.surface === 'unregister-search-test');
  assert.deepEqual(after, [], 'nothing from this surface once it is unregistered');
  assert.equal(allStrips().includes('unregister-search-test'), false);
});

test('registering the same surface twice replaces the getter rather than duplicating it', () => {
  unregisterStrip('replace-getter-test');
  try {
    const firstTabs = [descriptor('a', 'First label')];
    registerStrip('replace-getter-test', () => ({ tabs: firstTabs, state: createStripState('replace-getter-test', ['a']) }));

    const secondTabs = [descriptor('a', 'Second label')];
    let secondState = createStripState('replace-getter-test', ['a']);
    secondState = pin(secondState, 'a');
    registerStrip('replace-getter-test', () => ({ tabs: secondTabs, state: secondState }));

    assert.deepEqual(
      allStrips().filter((surface) => surface === 'replace-getter-test'),
      ['replace-getter-test'],
      'no duplicate entry for the surface after registering it twice',
    );

    const results = searchAllTabs(() => true).filter((result) => result.surface === 'replace-getter-test');
    assert.deepEqual(
      results,
      [{ surface: 'replace-getter-test', id: 'a', label: 'Second label', group: null, pinned: true, closed: false }],
      'the second getter answers a search, not the first: label and pinned state both come from the replacement',
    );
  } finally {
    unregisterStrip('replace-getter-test');
  }
});
