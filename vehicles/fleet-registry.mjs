export const CPTDB_TTC_URL = 'https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission';

const page = (range) => `https://cptdb.ca/wiki/index.php/Toronto_Transit_Commission_${range}`;

/**
 * Vehicle ranges transcribed from the linked CPTDB roster pages. Fields stay absent when the
 * source does not establish them consistently for the complete range.
 */
export const TTC_FLEET_RANGES = Object.freeze([
  { first: 1200, last: 1423, manufacturer: 'Orion Bus Industries', model: 'Orion VII Next Generation HEV', year: '2007–2008', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('1200-1423') },
  { first: 1500, last: 1689, manufacturer: 'Orion Bus Industries', model: 'Orion VII Next Generation HEV', year: '2008', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('1500-1689') },
  { first: 3100, last: 3369, manufacturer: 'Nova Bus', model: 'LFS', year: '2018–2019', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('3100-3369') },
  { first: 3400, last: 3654, manufacturer: 'New Flyer', model: 'Xcelsior XDE40', year: '2018–2019', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('3400-3654') },
  { first: 3700, last: 3724, manufacturer: 'New Flyer', model: 'Xcelsior XE40', year: '2019', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('3700-3724') },
  { first: 3725, last: 3749, manufacturer: 'Proterra', model: 'Catalyst BE40', year: '2019', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('3725-3749') },
  { first: 3750, last: 3769, manufacturer: 'BYD', model: 'K9M', year: '2019', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('3750-3769') },
  { first: 4400, last: 4603, manufacturer: 'Bombardier Transportation', model: 'Flexity Outlook', year: '2012–2024', propulsion: 'Electric', length: '30.2 m', capacity: '130 passengers', status: 'Active', url: page('4400-4603') },
  { first: 4604, last: 4663, manufacturer: 'Alstom', model: 'Flexity Outlook', year: '2023–2025', propulsion: 'Electric', length: '30.2 m', capacity: '130 passengers', status: 'Active', url: page('4604-4663') },
  { first: 6000, last: 6129, manufacturer: 'New Flyer', model: 'Xcelsior XE40 NG', year: '2024–2025', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('6000-6129') },
  { first: 6130, last: 6204, manufacturer: 'New Flyer', model: 'Xcelsior XE40 NG', year: '2025–2026', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('6130-6204') },
  { first: 6600, last: 6749, manufacturer: 'Nova Bus', model: 'LFSe+', year: '2025–2026', propulsion: 'Battery electric', length: '12.2 m', status: 'Active', url: page('6600-6749') },
  { first: 7000, last: 7133, manufacturer: 'Nova Bus', model: 'LFS HEV', year: '2023–2024', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('7000-7133') },
  { first: 7200, last: 7333, manufacturer: 'New Flyer', model: 'Xcelsior XDE40', year: '2023–2024', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('7200-7333') },
  { first: 8100, last: 8219, manufacturer: 'Orion Bus Industries', model: 'Orion VII Next Generation', year: '2010', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('8100-8219') },
  { first: 8300, last: 8396, manufacturer: 'Orion Bus Industries', model: 'Orion VII Next Generation', year: '2011–2012', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('8300-8396') },
  { first: 8400, last: 8617, manufacturer: 'Nova Bus', model: 'LFS', year: '2015–2016', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('8400-8617') },
  { first: 8620, last: 8964, manufacturer: 'Nova Bus', model: 'LFS', year: '2017–2018', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('8620-8964') },
  { first: 9000, last: 9152, manufacturer: 'Nova Bus', model: 'LFS Artic', year: '2013–2014', propulsion: 'Diesel', length: '18.9 m', capacity: '112 passengers', status: 'Active', url: page('9000-9152') },
  { first: 9200, last: 9239, manufacturer: 'Nova Bus', model: 'LFS', year: '2018', propulsion: 'Diesel', length: '12.2 m', status: 'Active', url: page('9200-9239') },
  { first: 9400, last: 9467, manufacturer: 'Nova Bus', model: 'LFS HEV', year: '2024', propulsion: 'Diesel-electric hybrid', length: '12.2 m', status: 'Active', url: page('9400-9467') },
]);

const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128);

export function matchCptdb(vehicleId, label = '') {
  const identity = clean(label) || clean(vehicleId);
  const numeric = /^\d{3,5}$/.test(identity) ? Number(identity) : NaN;
  const found = Number.isFinite(numeric) ? TTC_FLEET_RANGES.find((entry) => numeric >= entry.first && numeric <= entry.last) : undefined;
  if (found) {
    const { first, last, url, ...facts } = found;
    return { url, match: first === last ? 'vehicle' : 'series', fleetRange: `${first}-${last}`, ...facts };
  }
  const query = encodeURIComponent(`Toronto Transit Commission ${identity || 'vehicle'}`);
  return { url: `https://cptdb.ca/wiki/index.php?search=${query}`, match: identity ? 'search' : 'unmatched' };
}
