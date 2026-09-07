import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellationsFrom, parseCancellation, parseJourneyText, resolveTimes, serviceDateOf } from '../lib/go-alternatives.ts';
import { torontoIso } from '../lib/journey-utils.ts';

/**
 * The exact published wording, taken from two real Metrolinx cancellation alerts
 * on 6 September 2026. The parser accepts this form and nothing else: a station
 * name guessed out of a line that does not match would send a rider to the wrong
 * platform, which is worse than offering no alternative at all.
 */

const AURORA = {
  id: 'go-1',
  title: 'Train cancelled - Aurora GO 16:55 - Union Station 17:46',
  description: [
    'The Aurora GO 16:55 - Union Station 17:46 train has been cancelled due to crew constraints.',
    '',
    'Please consider the following train options:',
    '',
    'By GO train: Aurora GO 15:55 - Union Station 16:46',
    'By GO train: Allandale Waterfront GO 17:05 - Union Station 18:46',
    'Subscribe to On The GO alerts and receive customized, real-time alerts for schedule changes, construction updates and more. Sign up for On The GO alerts here.',
  ].join('\n'),
  activeFrom: '2026-09-06T18:00:00.000Z',
  updatedAt: '2026-09-06T18:05:00.000Z',
};

const UNION = {
  id: 'go-2',
  title: 'Train cancelled - Union Station 15:54 - Aurora GO 16:44',
  description: [
    'The Union Station 15:54 - Aurora GO 16:44 train has been cancelled due to crew constraints.',
    'Please consider the following train options:',
    'By GO train: Union Station 14:54 - Allandale Waterfront GO 16:37',
    'By GO train: Union Station 16:54 - Aurora GO 17:44',
  ].join('\n'),
  activeFrom: '2026-09-06T18:00:00.000Z',
};

test('a published journey line splits into origin, destination and both times', () => {
  const journey = parseJourneyText('Aurora GO 15:55 - Union Station 16:46');
  assert.equal(journey.from, 'Aurora GO');
  assert.equal(journey.to, 'Union Station');
  assert.equal(journey.departs, '15:55');
  assert.equal(journey.arrives, '16:46');
  assert.equal(journey.text, 'Aurora GO 15:55 - Union Station 16:46');
});

test('a station name with numbers in it is not mistaken for a time', () => {
  const journey = parseJourneyText('Exhibition GO 9:05 - Union Station 9:16');
  assert.equal(journey.from, 'Exhibition GO');
  assert.equal(journey.departs, '09:05');
});

test('a line that does not match the published form parses to nothing', () => {
  assert.equal(parseJourneyText('Take a bus from Aurora'), null);
  assert.equal(parseJourneyText('Aurora GO 25:99 - Union Station 16:46'), null);
  assert.equal(parseJourneyText('Aurora GO 15:55 - 16:46'), null);
});

test('a cancellation names the trip it cancels and the trains offered instead', () => {
  const parsed = parseCancellation(AURORA, torontoIso);
  assert.equal(parsed.cancelled.from, 'Aurora GO');
  assert.equal(parsed.cancelled.departs, '16:55');
  assert.equal(parsed.alternatives.length, 2);
  assert.deepEqual(parsed.alternatives.map((option) => option.from), ['Aurora GO', 'Allandale Waterfront GO']);
  assert.deepEqual(parsed.alternatives.map((option) => option.departs), ['15:55', '17:05']);
  assert.equal(parsed.alternatives[0].mode, 'GO train');
  assert.equal(parsed.serviceDate, '2026-09-06');
});

test('the subscription footer is not read as an alternative', () => {
  const parsed = parseCancellation(AURORA, torontoIso);
  assert.equal(parsed.alternatives.every((option) => !/Subscribe/i.test(option.text)), true);
  assert.equal(parsed.unparsed.length, 0);
});

test('the cancelled trip itself is never offered as an alternative', () => {
  const parsed = parseCancellation(AURORA, torontoIso);
  assert.equal(parsed.alternatives.some((option) => option.departs === parsed.cancelled.departs && option.from === parsed.cancelled.from), false);
});

test('published times are resolved to Toronto instants for planning', () => {
  const parsed = parseCancellation(AURORA, torontoIso);
  const [first] = parsed.alternatives;
  assert.equal(first.departsAt, '2026-09-06T19:55:00.000Z');
  assert.equal(first.arrivesAt, '2026-09-06T20:46:00.000Z');
  assert.equal(Date.parse(first.arrivesAt) > Date.parse(first.departsAt), true);
});

test('an arrival before its departure has crossed midnight, not gone backwards', () => {
  const overnight = resolveTimes(parseJourneyText('Union Station 23:50 - Aurora GO 00:40'), '2026-09-06', torontoIso);
  assert.equal(overnight.departsAt, '2026-09-07T03:50:00.000Z');
  assert.equal(overnight.arrivesAt, '2026-09-07T04:40:00.000Z');
  assert.equal(Date.parse(overnight.arrivesAt) - Date.parse(overnight.departsAt), 50 * 60000);
});

test('a service date is the Toronto calendar day, not the UTC one', () => {
  assert.equal(serviceDateOf({ activeFrom: '2026-09-07T03:30:00.000Z' }), '2026-09-06');
  assert.equal(serviceDateOf({ updatedAt: '2026-09-06T16:00:00.000Z' }), '2026-09-06');
  assert.equal(serviceDateOf({}), null);
});

test('without a service date the published times stand alone, unresolved', () => {
  const parsed = parseCancellation({ ...AURORA, activeFrom: undefined, updatedAt: undefined }, torontoIso);
  assert.equal(parsed.serviceDate, null);
  assert.equal(parsed.alternatives[0].departs, '15:55');
  assert.equal(parsed.alternatives[0].departsAt, undefined);
});

test('an ordinary service alert is never dressed up as a cancellation', () => {
  // The title decides. A facility notice that happens to contain an option line
  // is not a cancellation, however the description reads.
  assert.equal(parseCancellation({ title: 'Elevator out of service at Union Station', description: 'By GO train: Union Station 14:54 - Aurora GO 15:44' }, torontoIso), null);
});

test('a cancellation with nothing at all in its description parses to nothing', () => {
  assert.equal(parseCancellation({ title: 'Train cancelled - Aurora GO 16:55 - Union Station 17:46', description: '' }, torontoIso), null);
  // The subscription footer alone is boilerplate, not advice.
  assert.equal(parseCancellation({
    title: 'Train cancelled - Aurora GO 16:55 - Union Station 17:46',
    description: 'Subscribe to On the GO alerts and receive customized, real-time alerts.',
  }, torontoIso), null);
});

test('a cancellation whose description is only prose is kept, because it is still a disruption', () => {
  const parsed = parseCancellation({
    title: 'Train cancelled - Aurora GO 16:55 - Union Station 17:46',
    description: 'No alternative service is available for this trip.',
  }, torontoIso);
  assert.notEqual(parsed, null);
  assert.equal(parsed.advice, 'No alternative service is available for this trip.');
  assert.deepEqual(parsed.alternatives, []);
});

test('an option in an unrecognised form is kept as text, with no journey invented', () => {
  const parsed = parseCancellation({
    ...AURORA,
    description: 'Please consider the following train options:\nBy GO bus: travel via Highway 407 and change at Yorkdale',
  }, torontoIso);
  assert.deepEqual(parsed.alternatives, []);
  assert.equal(parsed.unparsed.length, 1);
  assert.match(parsed.unparsed[0], /Highway 407/);
});

test('a repeated option is listed once', () => {
  const parsed = parseCancellation({
    ...AURORA,
    description: 'Please consider the following train options:\nBy GO train: Aurora GO 15:55 - Union Station 16:46\nBy GO train: Aurora GO 15:55 - Union Station 16:46',
  }, torontoIso);
  assert.equal(parsed.alternatives.length, 1);
});

test('several alerts each yield their own cancellation', () => {
  const found = cancellationsFrom([AURORA, UNION, { title: 'Escalator notice', description: '' }], torontoIso);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((entry) => entry.alternatives.length), [2, 2]);
  assert.equal(found[1].cancelled.to, 'Aurora GO');
});

/**
 * A real alert taken from the live GO feed on 6 September 2026. It writes its
 * advice as prose rather than naming trains, which is the shape the structured
 * parser cannot read - and returning nothing for it would leave a live
 * disruption showing as "nothing is published".
 */
const STRATFORD = {
  id: 'go-live-1',
  title: 'Train cancelled - Stratford GO 18:16 - Union Station 20:45',
  description: 'The Stratford GO 18:16 - Union Station 20:45 train is cancelled due to crew constraints. Customers can board a GO bus at Stratford GO, making stops at Kitchener GO and Guelph Central GO to Mount Pleasant GO with GO train connections to Union Station. Subscribe to On the GO alerts and receive customized, real-time alerts for schedule changes, construction updates and more. Sign up for On The GO alerts here.',
  activeFrom: '2026-09-06T20:16:00.000Z',
  updatedAt: '2026-09-07T00:52:41.000Z',
};

test('a cancellation written as prose is still reported, with the wording kept whole', () => {
  const parsed = parseCancellation(STRATFORD, torontoIso);
  assert.notEqual(parsed, null, 'a live cancellation must never parse to nothing');
  assert.equal(parsed.cancelled.from, 'Stratford GO');
  assert.equal(parsed.cancelled.departs, '18:16');
  assert.deepEqual(parsed.alternatives, []);
  assert.deepEqual(parsed.unparsed, []);
  assert.match(parsed.advice, /board a GO bus at Stratford GO/);
  assert.match(parsed.advice, /Mount Pleasant GO/);
});

test('the subscription footer is not kept as advice', () => {
  const parsed = parseCancellation(STRATFORD, torontoIso);
  assert.equal(/Subscribe to On the GO alerts/i.test(parsed.advice), false);
  assert.equal(/Sign up for On The GO alerts/i.test(parsed.advice), false);
});

test('advice is not invented for an alert that names its trains', () => {
  const parsed = parseCancellation(AURORA, torontoIso);
  assert.equal(parsed.alternatives.length, 2);
  assert.equal(/By GO train/.test(parsed.advice), false, 'a named option is never repeated as prose');
});

test('a named option that ends its own sentence is still not repeated as advice', () => {
  // The option lines in the live feed run into the footer, so this fixture ends
  // the option with a full stop: it must be dropped for being an option, not for
  // sharing a sentence with the subscription footer.
  const parsed = parseCancellation({
    ...AURORA,
    description: [
      'The 16:55 train has been cancelled.',
      'Please consider the following train options.',
      'By GO train: Aurora GO 15:55 - Union Station 16:46.',
      'Travel time may be longer than usual.',
    ].join(String.fromCharCode(10)),
  }, torontoIso);
  assert.equal(parsed.alternatives.length, 1);
  assert.equal(/By GO train/.test(parsed.advice), false, 'the option must be dropped for being an option');
  assert.match(parsed.advice, /Travel time may be longer than usual/);
});
