import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCptdb } from '../vehicles/fleet-registry.mjs';

/**
 * Series taken from the published CPTDB rosters for GO Transit, Burlington Transit
 * and the Hamilton Street Railway, read on 6 September 2026 and kept only where the
 * range covers units the live feeds were actually reporting.
 */
const match = (agencyId, unit, agencyName) => matchCptdb(unit, unit, { agencyId, agencyName });

test('GO double-deckers, coaches and buses are identified from the published roster', () => {
  const decker = match('go', '8548', 'GO Transit');
  assert.equal(decker.manufacturer, 'ADL');
  assert.equal(decker.model, "Enviro500 'SuperLo'");
  assert.equal(decker.year, '2020-2021');
  const coach = match('go', '5012', 'GO Transit');
  assert.equal(coach.manufacturer, 'MCI');
  assert.equal(coach.model, 'D45 CRT');
});

test('the GO number band shared with rail coaches is deliberately left unmatched', () => {
  // 2500-2620 is used by both MCI buses and Bombardier BiLevel coaches on the same
  // roster, so a number alone cannot say which vehicle it is.
  for (const unit of ['2500', '2519', '2530', '2612']) {
    assert.equal(match('go', unit, 'GO Transit').manufacturer, undefined, unit);
  }
  // Bands outside the collision are still identified.
  assert.equal(match('go', '2560', 'GO Transit').model, 'D4500CT');
});

test('GO locomotives keep their existing curated series', () => {
  const locomotive = match('go', '604', 'GO Transit');
  assert.equal(locomotive.manufacturer, 'MotivePower');
  assert.equal(locomotive.propulsion, 'Diesel-electric');
});

test('a Burlington unit is identified only when its year suffix agrees', () => {
  const nova = match('burlington', '7019-15', 'Burlington Transit');
  assert.equal(nova.manufacturer, 'Nova Bus');
  assert.equal(nova.model, 'LFS');
  assert.equal(nova.year, '2015');
  const flyer = match('burlington', '7055-12', 'Burlington Transit');
  assert.equal(flyer.manufacturer, 'New Flyer');
  assert.equal(flyer.model, 'XD40');
  // The same number with a different suffix is a different vehicle, not this one.
  assert.equal(match('burlington', '7019-99', 'Burlington Transit').manufacturer, undefined);
  assert.equal(match('burlington', '7019-99', 'Burlington Transit').match, 'search');
});

test('a Burlington unit without a suffix matches its own unsuffixed series', () => {
  const nova = match('burlington', '71901', 'Burlington Transit');
  assert.equal(nova.manufacturer, 'Nova Bus');
  assert.equal(nova.year, '2019');
});

test('the reported fleet range shows the suffix when the series carries one', () => {
  assert.equal(match('burlington', '7019-15', 'Burlington Transit').fleetRange, '7017-15 to 7025-15');
  assert.equal(match('burlington', '71901', 'Burlington Transit').fleetRange, '71901-71907');
});

test('HSR natural-gas buses report the propulsion their roster publishes', () => {
  const cng = match('hsr', '1610', 'Hamilton Street Railway');
  assert.equal(cng.manufacturer, 'Nova Bus');
  assert.equal(cng.model, 'LFS Natural Gas');
  assert.equal(cng.propulsion, 'Compressed natural gas');
});

test('propulsion is left unknown where the roster does not state it', () => {
  // An XN60 is not described as diesel by its roster row, and inferring one from
  // the model would print a wrong fact with a citation attached to it.
  const articulated = match('hsr', '2360', 'Hamilton Street Railway');
  assert.equal(articulated.model, 'XN60');
  assert.equal(articulated.propulsion, undefined);
});

test('every added series cites the roster page it came from', () => {
  for (const [agency, unit, name] of [
    ['go', '8548', 'GO Transit'],
    ['burlington', '7019-15', 'Burlington Transit'],
    ['hsr', '2110', 'Hamilton Street Railway'],
  ]) {
    const found = match(agency, unit, name);
    assert.match(found.source.url, /^https:\/\/cptdb\.ca\/wiki\//, agency);
    assert.equal(typeof found.source.title, 'string');
    assert.equal(found.url, found.source.url);
  }
});

test('a unit outside every published series still gets a search, never a guess', () => {
  const unknown = match('hsr', '9999', 'Hamilton Street Railway');
  assert.equal(unknown.manufacturer, undefined);
  assert.equal(unknown.match, 'search');
  assert.equal(unknown.displayFleetNumber, '9999');
});

test('a current series is not blocked by a historic one that shares its numbers', () => {
  // The roster also lists a 1973 Rek-Vee at 1215-1216 and a 1989 MCI Classic at
  // 2204-2208. Neither is on the road in 2026, and letting them cancel the current
  // series left a quarter of the live fleet unidentified.
  const xd40 = match('hsr', '1215', 'Hamilton Street Railway');
  assert.equal(xd40.manufacturer, 'NFI');
  assert.equal(xd40.model, 'XD40');
  assert.equal(xd40.year, '2012');
  const nova = match('hsr', '2205', 'Hamilton Street Railway');
  assert.equal(nova.manufacturer, 'Nova Bus');
  assert.equal(nova.year, '2022');
});
