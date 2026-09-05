export const CPTDB_TTC_URL = 'https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission';
export const TTC_FLEET_SOURCE = 'https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-summary-2025-12-07.pdf?rev=ad117ec728ae47fd868aea9aaa1c3835';

const facts = (first, last, manufacturer, model, year, propulsion, length, capacity) => ({ first, last, manufacturer, model, year, propulsion, length, capacity, source: { url: TTC_FLEET_SOURCE, title: 'TTC Service Summary, December 7, 2025', updated: '2025-11-24' } });

/** Official TTC inventory ranges. Live observation is reported separately and is not a roster status. */
export const TTC_FLEET_RANGES = Object.freeze([
  facts(1200, 1423, 'Daimler Buses North America', 'Orion VII Next Generation', '2007-2008', 'Diesel-electric hybrid', '12 m', '36 seats'),
  facts(1500, 1689, 'Daimler Buses North America', 'Orion VII Next Generation', '2008', 'Diesel-electric hybrid', '12 m', '36 seats'),
  facts(3100, 3369, 'Nova Bus', 'LFS', '2018', 'Diesel', '12 m', '33 seats'),
  facts(3400, 3454, 'Nova Bus', 'LFS Hybrid', '2018', 'Diesel-electric hybrid', '12 m', '33 seats'),
  facts(3455, 3654, 'Nova Bus', 'LFS Hybrid', '2019', 'Diesel-electric hybrid', '12 m', '33 seats'),
  facts(3700, 3724, 'New Flyer', 'Xcelsior XE40', '2019-2020', 'Battery electric', '12 m', '33 seats'),
  facts(3750, 3759, 'BYD', 'K9M', '2019-2020', 'Battery electric', '12 m', '35 seats'),
  facts(6000, 6203, 'New Flyer', 'Xcelsior XE40', '2024-2025', 'Battery electric', '12 m', '33 seats'),
  facts(6600, 6735, 'Nova Bus', 'LFSe+', '2024', 'Battery electric', '12 m', '33 seats'),
  facts(7000, 7133, 'Nova Bus', 'LFS Hybrid', '2023-2024', 'Diesel-electric hybrid', '12 m', '33 seats'),
  facts(7200, 7333, 'New Flyer', 'Xcelsior XDE40', '2023-2024', 'Diesel-electric hybrid', '12 m', '33 seats'),
  facts(8100, 8219, 'Daimler Buses North America', 'Orion VII Next Generation', '2010', 'Diesel', '12 m', '36 seats'),
  facts(8300, 8396, 'Daimler Buses North America', 'Orion VII Next Generation', '2011-2012', 'Diesel', '12 m', '36 seats'),
  facts(8400, 8617, 'Nova Bus', 'LFS', '2015-2017', 'Diesel', '12 m', '33 seats'),
  facts(8620, 8964, 'Nova Bus', 'LFS', '2017', 'Diesel', '12 m', '33 seats'),
  facts(9000, 9152, 'Nova Bus', 'LFS Artic', '2013-2014', 'Diesel', '18 m', '46 seats'),
  facts(9200, 9239, 'Nova Bus', 'LFS', '2018', 'Diesel', '12 m', '33 seats'),
  facts(9400, 9468, 'New Flyer', 'Xcelsior XDE60', '2023-2025', 'Diesel-electric hybrid', '18 m', '50 seats'),
  facts(4400, 4603, 'Alstom', 'FLEXITY M-1', '2012-2019', 'Electric', '30 m', '70 seats'),
  facts(4604, 4663, 'Alstom', 'FLEXITY M-1', '2023-2024', 'Electric', '30 m', '70 seats'),
]);

const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128);
const searchUrl = (agencyName, identity) => `https://cptdb.ca/wiki/index.php?search=${encodeURIComponent(`${agencyName} ${identity || 'vehicle'}`)}`;

export function matchCptdb(vehicleId, label = '', { agencyId = 'ttc', agencyName = 'Toronto Transit Commission' } = {}) {
  const identity = clean(label) || clean(vehicleId);
  const numeric = /^\d{3,5}$/.test(identity) ? Number(identity) : NaN;
  const found = agencyId === 'ttc' && Number.isFinite(numeric) ? TTC_FLEET_RANGES.find((entry) => numeric >= entry.first && numeric <= entry.last) : undefined;
  if (found) {
    const { first, last, ...verifiedFacts } = found;
    return { url: searchUrl(agencyName, identity), match: 'search', fleetRange: `${first}-${last}`, observedLive: true, ...verifiedFacts };
  }
  return { url: searchUrl(agencyName, identity), match: identity ? 'search' : 'unmatched', observedLive: Boolean(identity) };
}
