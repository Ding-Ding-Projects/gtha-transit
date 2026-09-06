import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  superExpressFor,
  goBranch,
  isGoAgency,
  SUPER_EXPRESS_IDENTITIES,
  SUPER_EXPRESS_PROVENANCE,
} from '../lib/go-express.ts';

/**
 * Leg shape observed on the deployed build: GO publishes the branch at the head
 * of the headsign, while its route catalog carries the bare number only.
 */
const leg56A = { agency: 'GO Transit', route: '56', headsign: '56A - DC Oshawa GO' };

test('the declared identity list is exactly the six requested services', () => {
  assert.deepEqual([...SUPER_EXPRESS_IDENTITIES], ['12B', '16', '25C', '47D', '56A', '88C']);
});

test('a declared branch is matched from the published headsign prefix', () => {
  const match = superExpressFor(leg56A);
  assert.equal(match.identity, '56A');
  assert.equal(match.scope, 'branch');
  assert.equal(match.provenance, SUPER_EXPRESS_PROVENANCE);
});

test('every declared branch matches on its own route', () => {
  const cases = [
    { route: '12', headsign: '12B - Niagara Falls', identity: '12B' },
    { route: '25', headsign: '25C - Aberfoyle', identity: '25C' },
    { route: '47', headsign: '47D - Hwy 407 Bus Terminal', identity: '47D' },
    { route: '88', headsign: '88C - Hamilton GO Centre', identity: '88C' },
  ];
  for (const item of cases) {
    const match = superExpressFor({ agency: 'GO Transit', route: item.route, headsign: item.headsign });
    assert.equal(match?.identity, item.identity, item.identity);
    assert.equal(match?.scope, 'branch');
  }
});

test('route 16 is declared for the whole route, with no branch letter', () => {
  const match = superExpressFor({ agency: 'GO Transit', route: '16', headsign: 'Hamilton / Toronto Express' });
  assert.equal(match.identity, '16');
  assert.equal(match.scope, 'route');
});

test('an undeclared branch on a declared route is not labelled', () => {
  assert.equal(superExpressFor({ agency: 'GO Transit', route: '56', headsign: '56B - Somewhere' }), null);
  assert.equal(superExpressFor({ agency: 'GO Transit', route: '25', headsign: '25A - Somewhere' }), null);
});

test('a declared route number without its declared branch is not labelled', () => {
  assert.equal(superExpressFor({ agency: 'GO Transit', route: '56', headsign: 'Oshawa GO' }), null);
  assert.equal(superExpressFor({ agency: 'GO Transit', route: '88', headsign: '88 - Hamilton' }), null);
});

test('another agency is never labelled, even on a matching number', () => {
  assert.equal(superExpressFor({ agency: 'TTC', route: '16', headsign: '16 McCowan' }), null);
  assert.equal(superExpressFor({ agency: 'York Region Transit', route: '56', headsign: '56A - Anywhere' }), null);
  assert.equal(superExpressFor({ agency: null, route: '16', headsign: 'x' }), null);
});

test('the branch reader only accepts this route number plus one letter', () => {
  assert.equal(goBranch('56', '56A - DC Oshawa GO'), '56A');
  assert.equal(goBranch('56', '56 - DC Oshawa GO'), null);
  assert.equal(goBranch('56', '561 - DC Oshawa GO'), null);
  assert.equal(goBranch('56', '5 - DC Oshawa GO'), null);
  assert.equal(goBranch('56', '156A - DC Oshawa GO'), null);
  assert.equal(goBranch('56', 'DC Oshawa GO'), null);
  assert.equal(goBranch('56', ''), null);
  assert.equal(goBranch('', '56A - x'), null);
});

test('the agency test accepts the published GO name only', () => {
  assert.equal(isGoAgency('GO Transit'), true);
  assert.equal(isGoAgency('go transit'), true);
  assert.equal(isGoAgency('GO Transit Rail'), false);
  assert.equal(isGoAgency('Metrolinx'), false);
});

test('a walking leg carries no route and is never labelled', () => {
  assert.equal(superExpressFor({ agency: 'GO Transit', route: null, headsign: '56A - x' }), null);
});
