/**
 * Has the TTC published a Service Summary newer than the one we ship?
 *
 * The refresh contract in docs/vehicles/out-of-division.md has always required
 * that refresh code discover the current file from the publisher page rather than
 * construct a filename. There was no code, so it was done by hand every time, and
 * the shipped receipt sat three days past its period before anyone looked.
 *
 * Deliberately not part of `npm test`, for the same reason as
 * scripts/check-sources.mjs: it makes a real network request to somebody else's
 * server, so a suite that ran it would fail on an aeroplane and teach everybody to
 * ignore it.
 *
 * It reports and never gates. Data outside its period is the intended state
 * between board periods: the planner keeps answering from the last published
 * summary, labelled with the period it covers, until a newer one exists. A check
 * that went red for that would be red for days at a time over behaviour the
 * project chose on purpose. The only non-zero exit is for a request that failed,
 * which is a fact about the network rather than about the data.
 *
 * Usage:
 *   node scripts/check-ttc-summary.mjs [--json]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const registry = JSON.parse(readFileSync(path.join(root, 'data', 'ttc-divisions.json'), 'utf8'));

const PUBLISHER_PAGE = registry.source.publisherPage;
const AGENT = 'gtha-transit source check (https://toronto-transit.org)';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Today, as a Toronto calendar day, because a board period is a Toronto date range. */
function torontoToday(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The start date a summary link names, from the filename rather than the prose.
 *
 * The link text is written by hand and has varied ("July 26 to September 5, 2026",
 * "September 6 to October 31, 2026", with and without a comma after Summary). The
 * filename carries the same date in one shape and is what the receipt cites.
 */
function summariesOn(html) {
  const found = new Map();
  const link = /href="([^"]*Service-Summary-(\d{4})-(\d{2})-(\d{2})\.pdf[^"]*)"/gi;
  for (const match of html.matchAll(link)) {
    const [, href, year, month, day] = match;
    const url = href.startsWith('http') ? href : new URL(href, PUBLISHER_PAGE).href;
    found.set(`${year}-${month}-${day}`, url.replace(/&amp;/g, '&'));
  }
  return [...found].map(([validFrom, url]) => ({ validFrom, url })).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

/** The period a link's own text names, when the page states one, for the report only. */
function describe(html, validFrom) {
  const [year, month, day] = validFrom.split('-');
  const monthName = MONTHS[Number(month) - 1];
  const pattern = new RegExp(`Service Summary[^<]{0,80}${monthName}\\s+${Number(day)}[^<]{0,60}`, 'i');
  return html.match(pattern)?.[0].replace(/\s+/g, ' ').trim() ?? null;
}

async function main() {
  const wantsJson = process.argv.includes('--json');
  const today = torontoToday();
  const shipped = registry.source;

  let html;
  try {
    const response = await fetch(PUBLISHER_PAGE, { headers: { 'user-agent': AGENT }, redirect: 'follow' });
    if (!response.ok) throw new Error(`the publisher page answered ${response.status}`);
    html = await response.text();
  } catch (error) {
    // A failed request says nothing about the data, so the shipped receipt is
    // reported anyway rather than leaving the reader with only an error.
    console.error(`could not read ${PUBLISHER_PAGE}: ${error.message}`);
    console.error(`shipped: ${shipped.title} (${shipped.validFrom} to ${shipped.validThrough})`);
    process.exit(1);
  }

  const published = summariesOn(html);
  const newer = published.filter((summary) => summary.validFrom > shipped.validFrom);
  const daysPast = today > shipped.validThrough
    ? Math.round((Date.parse(today) - Date.parse(shipped.validThrough)) / 86_400_000)
    : 0;

  if (wantsJson) {
    console.log(JSON.stringify({ today, shipped, published, newer, daysPastValidThrough: daysPast }, null, 2));
    return;
  }

  console.log(`shipped:   ${shipped.title}`);
  console.log(`           ${shipped.validFrom} to ${shipped.validThrough}, allocation updated ${shipped.fleetAllocationUpdated}`);
  console.log(`today:     ${today}`);
  console.log(daysPast === 0
    ? '           within the period it covers'
    : `           ${daysPast} day${daysPast === 1 ? '' : 's'} past it, answering from the last published summary`);
  console.log(`\npublished on the TTC page (${published.length}):`);
  for (const summary of published) {
    const marker = summary.validFrom === shipped.validFrom ? ' <- shipped' : summary.validFrom > shipped.validFrom ? ' <- NEWER' : '';
    console.log(`  ${summary.validFrom}  ${describe(html, summary.validFrom) ?? '(period not stated in the link text)'}${marker}`);
  }

  if (newer.length === 0) {
    console.log('\nNo newer summary is published. Do not extend validThrough; the planner keeps');
    console.log('answering from the shipped one and says which period it describes.');
    return;
  }
  console.log(`\n${newer.length} newer summary is published. To refresh:`);
  for (const summary of newer) console.log(`  ${summary.url}`);
  console.log('\nThe route and allocation tables have to be re-read from the document itself.');
  console.log('docs/vehicles/out-of-division.md records how, and which routes needed settling by hand.');
}

await main();
