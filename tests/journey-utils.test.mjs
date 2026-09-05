import test from 'node:test';
import assert from 'node:assert/strict';
import {torontoIso,torontoLocalInput,isPlace,torontoTomorrowAtNine,updateTorontoInputPart,resolveTorontoTime,shiftTorontoTime} from '../lib/journey-utils.ts';
test('Toronto date conversion accounts for winter, summer and the actual DST transition',()=>{assert.equal(torontoIso('2026-01-15T12:00'),'2026-01-15T17:00:00.000Z');assert.equal(torontoIso('2026-07-15T12:00'),'2026-07-15T16:00:00.000Z');assert.equal(torontoIso('2026-03-08T03:30'),'2026-03-08T07:30:00.000Z');});
test('Nonexistent time is rejected and repeated time explicitly chooses earlier occurrence',()=>{assert.throws(()=>torontoIso('2026-03-08T02:30'));assert.equal(torontoIso('2026-11-01T01:30'),'2026-11-01T05:30:00.000Z');assert.throws(()=>torontoIso('2026-02-30T12:00'));});
test('Saved coordinates cannot inject invalid values into the map',()=>{assert.equal(isPlace({id:'a',name:'Union',lat:43.64,lon:-79.38}),true);for(const lat of [NaN,Infinity,91,'43'])assert.equal(isPlace({id:'a',name:'Union',lat,lon:0}),false);assert.equal(isPlace({name:'Incomplete'}),false);});

test('Tomorrow uses the Toronto calendar through both daylight-saving boundaries', () => {
  assert.equal(torontoTomorrowAtNine(new Date('2026-03-08T04:30:00Z')), '2026-03-08T09:00');
  assert.equal(torontoTomorrowAtNine(new Date('2026-11-01T04:30:00Z')), '2026-11-02T09:00');
});

test('Tomorrow handles Toronto month, year and leap-day boundaries', () => {
  for (const [instant, expected] of [
    ['2026-02-01T04:30:00Z', '2026-02-01T09:00'],
    ['2027-01-01T04:30:00Z', '2027-01-01T09:00'],
    ['2028-02-29T04:30:00Z', '2028-02-29T09:00'],
    ['2028-03-01T04:30:00Z', '2028-03-01T09:00'],
  ]) assert.equal(torontoTomorrowAtNine(new Date(instant)), expected);
  assert.throws(() => torontoTomorrowAtNine(new Date(NaN)));
});

test('Native date and time edits preserve the other field, including every clearing order', () => {
  assert.equal(updateTorontoInputPart('2026-09-05T09:00', 'date', '2026-09-06'), '2026-09-06T09:00');
  assert.equal(updateTorontoInputPart('2026-09-05T09:00', 'time', '10:30'), '2026-09-05T10:30');
  for (const first of ['date', 'time']) {
    const second = first === 'date' ? 'time' : 'date';
    const partial = updateTorontoInputPart('2026-09-05T09:00', first, '');
    assert.equal(partial, first === 'date' ? 'T09:00' : '2026-09-05T');
    assert.throws(() => resolveTorontoTime(partial));
    const empty = updateTorontoInputPart(partial, second, '');
    assert.equal(empty, 'T');
    assert.throws(() => resolveTorontoTime(empty));
    const restoredFirst = updateTorontoInputPart(empty, first, first === 'date' ? '2026-09-05' : '09:00');
    const restored = updateTorontoInputPart(restoredFirst, second, second === 'date' ? '2026-09-05' : '09:00');
    assert.equal(restored, '2026-09-05T09:00');
  }
  assert.equal(updateTorontoInputPart('', 'time', '09:00'), 'T09:00');
  assert.equal(updateTorontoInputPart('', 'date', '2026-09-05'), '2026-09-05T');
});

test('Impossible calendar values and malformed wall times cannot normalize into valid journeys', () => {
  for (const value of ['', 'T', '2026-02-30T12:00', '2026-02-29T12:00', '2026-04-31T12:00', '2026-09-05T24:00', '2026-13-01T12:00', '2026-00-01T12:00', '2026-01-00T12:00', '2026-01-01T12:60', '2026-9-05T09:00', '2026-09-05T09:00:00']) {
    assert.throws(() => torontoIso(value), value);
    assert.throws(() => resolveTorontoTime(value, '2026-09-05T13:00:00Z'), value);
  }
});

test('Shared explicit instants preserve either occurrence of the repeated hour', () => {
  const value = '2026-11-01T01:30';
  assert.equal(resolveTorontoTime(value), '2026-11-01T05:30:00.000Z');
  for (const instant of ['2026-11-01T06:30:00Z', '2026-11-01T01:30:00-05:00']) {
    const received = torontoLocalInput(new Date(instant));
    assert.equal(received, value);
    assert.equal(resolveTorontoTime(received, instant), '2026-11-01T06:30:00.000Z');
  }
  assert.equal(resolveTorontoTime(value, '2026-11-01T05:30:00Z'), '2026-11-01T05:30:00.000Z');
});

test('Invalid or stale explicit instants fall back without overriding visible fields', () => {
  for (const instant of ['', 'invalid', '2026-11-01T01:30:00', '2026-11-01T01:30:60-05:00', '2026-11-01T01:30:00+99:00', '2026-11-01T07:30:00Z']) {
    assert.equal(resolveTorontoTime('2026-11-01T01:30', instant), '2026-11-01T05:30:00.000Z');
  }
  assert.equal(resolveTorontoTime('2026-03-02T01:30', '2026-02-30T01:30:00-05:00'), '2026-03-02T06:30:00.000Z');
  assert.throws(() => resolveTorontoTime('2026-03-08T02:30', '2026-03-08T07:30:00Z'));
});

test('Elapsed later and earlier actions cross the repeated hour with exact instant round trips', () => {
  const later = shiftTorontoTime('2026-11-01T01:45', 30);
  assert.deepEqual(later, { local: '2026-11-01T01:15', instant: '2026-11-01T06:15:00.000Z' });
  assert.equal(resolveTorontoTime(later.local, later.instant), later.instant);
  assert.deepEqual(shiftTorontoTime(later.local, -30, later.instant), { local: '2026-11-01T01:45', instant: '2026-11-01T05:45:00.000Z' });
});

test('Elapsed earlier and later actions cross the missing hour and midnight', () => {
  const later = shiftTorontoTime('2026-03-08T01:45', 30);
  assert.deepEqual(later, { local: '2026-03-08T03:15', instant: '2026-03-08T07:15:00.000Z' });
  assert.deepEqual(shiftTorontoTime(later.local, -30, later.instant), { local: '2026-03-08T01:45', instant: '2026-03-08T06:45:00.000Z' });
  assert.deepEqual(shiftTorontoTime('2026-09-05T00:15', -30), { local: '2026-09-04T23:45', instant: '2026-09-05T03:45:00.000Z' });
});

test('Time shifting rejects invalid inputs and unrepresentable elapsed values', () => {
  for (const minutes of [NaN, Infinity, -Infinity, 0.5, Number.MAX_VALUE]) assert.throws(() => shiftTorontoTime('2026-09-05T09:00', minutes));
  assert.throws(() => shiftTorontoTime('T09:00', 30));
  assert.throws(() => shiftTorontoTime('2026-03-08T02:30', 30));
});
