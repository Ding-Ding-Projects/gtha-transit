import test from 'node:test';
import assert from 'node:assert/strict';
import { PROPULSION_CLASSES, propulsionClass, isElectric, propulsionLabel } from '../vehicles/propulsion.mjs';
import { TTC_FLEET_RANGES, OTHER_FLEET_RANGES } from '../vehicles/fleet-registry.mjs';
import { REGIONAL_FLEET_RANGES } from '../vehicles/regional-fleet.mjs';

/**
 * Every distinct `propulsion` string actually published across the two
 * roster modules, mapped to the class it must resolve to. This is a
 * maintained, hand-written table rather than something derived from
 * `propulsionClass` itself: deriving the expectation from the function under
 * test would make every mapping trivially "correct" and catch nothing.
 *
 * Adding a fleet row with a new, unlisted propulsion string fails the test
 * below rather than silently classifying as `unknown`: a maintainer must
 * add the string here (and, if it needs one, a new keyword rule in
 * `vehicles/propulsion.mjs`) before the suite passes again.
 */
const EXPECTED_CLASS_BY_ROSTER_STRING = {
  'Battery electric': 'battery-electric',
  'Battery electric (converted 2024)': 'battery-electric',
  Electric: 'electric',
  'Diesel-electric hybrid': 'hybrid',
  Diesel: 'diesel',
  'Diesel-electric': 'diesel',
  'Diesel multiple unit': 'diesel',
  'Compressed natural gas': 'cng',
};

function allRosterRows() {
  return [
    ...TTC_FLEET_RANGES,
    ...Object.values(OTHER_FLEET_RANGES).flat(),
    ...Object.values(REGIONAL_FLEET_RANGES).flat(),
  ];
}

function distinctPublishedPropulsionStrings() {
  const values = new Set();
  for (const row of allRosterRows()) {
    if (typeof row.propulsion === 'string' && row.propulsion.trim()) values.add(row.propulsion);
  }
  return values;
}

test('every distinct published roster propulsion string is a recognised, correctly classified string', () => {
  const found = distinctPublishedPropulsionStrings();
  assert.ok(found.size > 0, 'expected at least one roster row to publish a propulsion string');

  for (const value of found) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EXPECTED_CLASS_BY_ROSTER_STRING, value),
      `roster propulsion string ${JSON.stringify(value)} has no maintained expected class in this test; add one`,
    );
    const expected = EXPECTED_CLASS_BY_ROSTER_STRING[value];
    assert.ok(PROPULSION_CLASSES.includes(expected), `test table names an unknown class for ${JSON.stringify(value)}`);
    assert.equal(propulsionClass({ propulsion: value }), expected, `${JSON.stringify(value)} should classify as ${expected}`);
  }

  // The reverse direction: every maintained expectation should still be reachable from
  // the live roster data, so a removed or renamed string is noticed here too.
  for (const value of Object.keys(EXPECTED_CLASS_BY_ROSTER_STRING)) {
    assert.ok(found.has(value), `expected roster propulsion string ${JSON.stringify(value)} is no longer published by any roster row`);
  }
});

test('propulsion classification is case-insensitive, keyword-ordered, and unknown for absent or unrecognised text', () => {
  assert.equal(propulsionClass({ propulsion: 'BATTERY ELECTRIC' }), 'battery-electric');
  assert.equal(propulsionClass({ propulsion: '  Diesel-Electric Hybrid  ' }), 'hybrid');
  // "Diesel-electric hybrid" must resolve to hybrid, not diesel: the hybrid check runs
  // before the plain diesel check specifically so a hybrid's own name is not read as
  // half diesel, half electric. "Diesel-electric" alone (no "hybrid") is diesel-powered,
  // not a verified electric vehicle, and must not resolve to electric or battery-electric.
  assert.equal(propulsionClass({ propulsion: 'Diesel-electric' }), 'diesel');
  assert.equal(propulsionClass({ propulsion: 'Natural Gas' }), 'cng');
  assert.equal(propulsionClass({ propulsion: 'CNG' }), 'cng');
  assert.equal(propulsionClass({ propulsion: 'Electric' }), 'electric');
  for (const missing of [undefined, null, '', '   ', 'Fuel cell', 'Trolleybus', 'Steam']) {
    assert.equal(propulsionClass({ propulsion: missing }), 'unknown', String(missing));
  }
  assert.equal(propulsionClass({}), 'unknown');
  assert.equal(propulsionClass(undefined), 'unknown');
});

test('isElectric is true only for a verified battery-electric or electric class, and never for unknown', () => {
  const expected = {
    'battery-electric': true,
    electric: true,
    hybrid: false,
    diesel: false,
    cng: false,
    unknown: false,
  };
  assert.deepEqual(new Set(PROPULSION_CLASSES), new Set(Object.keys(expected)), 'test table must cover every class propulsion.mjs defines');
  for (const [cls, expectedElectric] of Object.entries(expected)) {
    assert.equal(isElectric(cls), expectedElectric, cls);
  }
  // A class this module has never heard of is not electric either: isElectric
  // never defaults to true for anything outside its two verified electric classes.
  assert.equal(isElectric('fuel-cell'), false);
  assert.equal(isElectric(undefined), false);
});

test('every propulsion class has a non-empty bilingual label, and an unrecognised class falls back to the unknown label', () => {
  const expectedLabels = {
    'battery-electric': { en: 'Battery electric', zh: '電池電動' },
    electric: { en: 'Electric', zh: '電動' },
    hybrid: { en: 'Hybrid', zh: '混能' },
    diesel: { en: 'Diesel', zh: '柴油' },
    cng: { en: 'Natural gas', zh: '天然氣' },
    unknown: { en: 'Unknown', zh: '未知' },
  };
  for (const cls of PROPULSION_CLASSES) {
    const label = propulsionLabel(cls);
    assert.deepEqual(label, expectedLabels[cls], cls);
    assert.ok(label.en.trim().length > 0, `${cls} English label must not be blank`);
    assert.ok(label.zh.trim().length > 0, `${cls} Cantonese label must not be blank`);
  }
  assert.deepEqual(propulsionLabel('not-a-real-class'), expectedLabels.unknown);
  assert.deepEqual(propulsionLabel(undefined), expectedLabels.unknown);
});

test('the streetcar label applies only to the electric class, and only when requested', () => {
  assert.deepEqual(propulsionLabel('electric', { streetcar: true }), { en: 'Electric (streetcar)', zh: '電動（電車）' });
  // Without the streetcar flag, or on a different class entirely (even one that is also
  // electric), the plain label stands: a trolleybus or wired vehicle sharing the
  // "electric" class but not a streetcar must not be mislabelled either way.
  assert.deepEqual(propulsionLabel('electric'), { en: 'Electric', zh: '電動' });
  assert.deepEqual(propulsionLabel('electric', { streetcar: false }), { en: 'Electric', zh: '電動' });
  assert.deepEqual(propulsionLabel('battery-electric', { streetcar: true }), { en: 'Battery electric', zh: '電池電動' });

  // Tie the special case to the real roster: TTC's FLEXITY M-1 rows are the only
  // "Electric" (as opposed to "Battery electric") series in either roster module today,
  // and they are the streetcar fleet the module's own documentation names.
  const flexity = allRosterRows().filter((row) => row.model === 'FLEXITY M-1');
  assert.ok(flexity.length > 0, 'expected the TTC roster to still publish the FLEXITY M-1 streetcar series');
  for (const row of flexity) {
    const cls = propulsionClass(row);
    assert.equal(cls, 'electric');
    assert.deepEqual(propulsionLabel(cls, { streetcar: true }), { en: 'Electric (streetcar)', zh: '電動（電車）' });
  }
  // No other roster row published today is classified "electric" (as opposed to
  // "battery-electric"), so the streetcar label never quietly leaks onto some other bus.
  const electricNonStreetcar = allRosterRows().filter((row) => propulsionClass(row) === 'electric' && row.model !== 'FLEXITY M-1');
  assert.deepEqual(electricNonStreetcar, []);
});
