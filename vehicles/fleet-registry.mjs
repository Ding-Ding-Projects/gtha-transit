import { REGIONAL_FLEET_RANGES } from './regional-fleet.mjs';
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

export const OTHER_FLEET_RANGES = Object.freeze({
  ...REGIONAL_FLEET_RANGES,
  go: [
    { first: 600, last: 646, manufacturer: 'MotivePower', model: 'MP40PH-3C', year: '2007-2010', propulsion: 'Diesel-electric', source: { url: 'https://cptdb.ca/wiki/index.php/GO_Transit_600-666', title: 'GO Transit 600-666' } },
    { first: 647, last: 647, manufacturer: 'MotivePower', model: 'MP54AC prototype', year: '2015', propulsion: 'Diesel-electric', source: { url: 'https://cptdb.ca/wiki/index.php/GO_Transit_600-666', title: 'GO Transit 600-666' } },
    { first: 648, last: 656, manufacturer: 'MotivePower', model: 'MP40PH-3C', year: '2010-2011', propulsion: 'Diesel-electric', source: { url: 'https://cptdb.ca/wiki/index.php/GO_Transit_600-666', title: 'GO Transit 600-666' } },
    { first: 657, last: 666, manufacturer: 'MotivePower', model: 'MP40PH-3C', year: '2013-2014', propulsion: 'Diesel-electric', source: { url: 'https://cptdb.ca/wiki/index.php/GO_Transit_600-666', title: 'GO Transit 600-666' } },
    { first: 667, last: 682, manufacturer: 'MotivePower', model: 'MP54AC / MP40PHT-T4AC', year: '2017-2018', propulsion: 'Diesel-electric', source: { url: 'https://cptdb.ca/wiki/index.php/GO_Transit_667-682', title: 'GO Transit 667-682' } },
    // Buses and coaches from the published GO roster. The 2500-2620 band is left out
    // because the same numbers are used there by BiLevel rail coaches, so a number
    // alone cannot say which vehicle it is.
    { first: 2450, last: 2470, manufacturer: "MCI", model: "D4500CT", year: "2011", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 2554, last: 2606, manufacturer: "MCI", model: "D4500CT", year: "2014", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 5000, last: 5079, manufacturer: "MCI", model: "D45 CRT", year: "2025-2026", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 5080, last: 5177, manufacturer: "MCI", model: "D45 CRT", year: "2026", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8300, last: 8337, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2016", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8338, last: 8378, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2017", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8379, last: 8431, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2017-2018", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8432, last: 8447, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2018-2019", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8448, last: 8452, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2019", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8453, last: 8499, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2019", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8500, last: 8521, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2019", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
    { first: 8522, last: 8567, manufacturer: "ADL", model: "Enviro500 'SuperLo'", year: "2020-2021", source: { url: "https://cptdb.ca/wiki/index.php/GO_Transit", title: "GO Transit roster, CPTDB Wiki" } },
  ],
  burlington: [
    // Burlington writes a two-digit delivery-year suffix on each unit, so a series
    // matches only when that suffix agrees as well as the number.
    { first: 7054, last: 7059, suffix: "12", manufacturer: "New Flyer", model: "XD40", year: "2012", source: { url: "https://cptdb.ca/wiki/index.php/Burlington_Transit", title: "Burlington Transit roster, CPTDB Wiki" } },
    { first: 7017, last: 7025, suffix: "15", manufacturer: "Nova Bus", model: "LFS", year: "2015", source: { url: "https://cptdb.ca/wiki/index.php/Burlington_Transit", title: "Burlington Transit roster, CPTDB Wiki" } },
    { first: 71901, last: 71907, manufacturer: "Nova Bus", model: "LFS", year: "2019", source: { url: "https://cptdb.ca/wiki/index.php/Burlington_Transit", title: "Burlington Transit roster, CPTDB Wiki" } },
  ],
  hsr: [
    { first: 1101, last: 1117, manufacturer: "NFI", model: "XD40", year: "2012", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1420, last: 1437, manufacturer: "NFI", model: "XN60", year: "2015", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1501, last: 1524, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2015-16", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1601, last: 1643, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2016", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1701, last: 1719, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2018", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1801, last: 1811, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2018", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1820, last: 1830, manufacturer: "NFI", model: "XN60", year: "2018-19", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 1845, last: 1850, manufacturer: "Grande West", model: "Vicinity CNG", year: "2019", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 2101, last: 2120, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2022", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 2251, last: 2292, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2023", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 2301, last: 2314, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2024", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 2315, last: 2326, manufacturer: "Nova Bus", model: "LFS Natural Gas", year: "2025", propulsion: "Compressed natural gas", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
    { first: 2351, last: 2370, manufacturer: "NFI", model: "XN60", year: "2023", source: { url: "https://cptdb.ca/wiki/index.php/Hamilton_Street_Railway", title: "Hamilton Street Railway roster, CPTDB Wiki" } },
  ],
  up: [
    { first: 1001, last: 1012, manufacturer: 'Nippon Sharyo', model: 'DMU A-car', year: '2014-2015', propulsion: 'Diesel multiple unit', source: { url: 'https://cptdb.ca/wiki/index.php/Union_Pearson_Express_1001-1012', title: 'Union Pearson Express 1001-1012' } },
    { first: 3001, last: 3006, manufacturer: 'Nippon Sharyo', model: 'DMU C-car', year: '2014-2015', propulsion: 'Diesel multiple unit', source: { url: 'https://cptdb.ca/wiki/index.php/Union_Pearson_Express_3001-3006', title: 'Union Pearson Express 3001-3006' } },
  ],
});

const PHOTOS = Object.freeze({
  'LFS Hybrid': { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f4/Blue_Night_TTC_Bus_3539_at_Rouge_Hill_GO_Station%2C_July_11_2026.jpg/960px-Blue_Night_TTC_Bus_3539_at_Rouge_Hill_GO_Station%2C_July_11_2026.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Blue_Night_TTC_Bus_3539_at_Rouge_Hill_GO_Station,_July_11_2026.jpg', credit: 'Dillan Payne', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', depictedVehicleIds: ['3539'] },
  'FLEXITY M-1': { url: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Flexity_Outlook_4412_TTC_Streetcar_%2827418871405%29.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Flexity_Outlook_4412_TTC_Streetcar_(27418871405).jpg', credit: 'Peter Broster', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' },
});

export const AGENCY_PHOTOS = Object.freeze({
  miway: { url: 'https://upload.wikimedia.org/wikipedia/commons/b/be/MiWay_bus_at_UTM_IMG_6836.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:MiWay_bus_at_UTM_IMG_6836.jpg', credit: 'Robert T Bell', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', exactVehicle: false },
  burlington: { url: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Burlington_Transit_2018_NovaBus_LFS_7036-18.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Burlington_Transit_2018_NovaBus_LFS_7036-18.jpg', credit: 'DiltonPlayzYT', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', exactVehicle: false, depictedVehicleIds: ['7036-18'] },
  go: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/ce/Milton_GO_Train_Eastbound.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Milton_GO_Train_Eastbound.jpg', credit: 'GTDAquitaine', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:Milton_GO_Train_Eastbound.jpg', exactVehicle: false, depictedVehicleIds: ['604'] },
  up: { url: 'https://upload.wikimedia.org/wikipedia/commons/6/64/Toronto_ON_UP-1012_Nippon-Sharyo-DMU_2019-04-01.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Toronto_ON_UP-1012_Nippon-Sharyo-DMU_2019-04-01.jpg', credit: 'Milan Suvajac', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', exactVehicle: false, depictedVehicleIds: ['1012'] },
});
export const VERIFIED_PHOTO_URLS=Object.freeze([...Object.values(PHOTOS),...Object.values(AGENCY_PHOTOS)].map(photo=>photo.url));

const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128);
const searchUrl = (agencyName, identity) => `https://cptdb.ca/wiki/index.php?search=${encodeURIComponent(`${agencyName} ${identity || 'vehicle'}`)}`;
const fleetLike = (value) => /^[A-Za-z]?\d{3,6}(?:-\d{2})?$/.test(value);

export function resolveFleetNumber(vehicleId, label = '') {
  const cleanLabel = clean(label); const cleanId = clean(vehicleId).replace(/^[a-z]+:/i, '');
  return fleetLike(cleanLabel) ? cleanLabel : fleetLike(cleanId) ? cleanId : cleanLabel || cleanId;
}

export function matchCptdb(vehicleId, label = '', { agencyId = 'ttc', agencyName = 'Toronto Transit Commission' } = {}) {
  const identity = resolveFleetNumber(vehicleId, label);
  const parts = /^([A-Za-z]?)(\d{3,6})(?:-(\d{2}))?$/.exec(identity);
  const numeric = parts ? Number(parts[2]) : NaN;
  const prefix = parts?.[1].toLowerCase() || '';
  const ranges = agencyId === 'ttc' ? TTC_FLEET_RANGES : OTHER_FLEET_RANGES[agencyId] ?? [];
  const unitSuffix = parts?.[3] ?? null;
  const found = Number.isFinite(numeric) ? ranges.find((entry) => prefix === (entry.prefix || '').toLowerCase()
    && numeric >= entry.first && numeric <= entry.last
    && (!entry.suffix || entry.suffix === unitSuffix)) : undefined;
  if (found) {
    const { first, last, suffix, ...verifiedFacts } = found;
    const exactPage = agencyId !== 'ttc' && verifiedFacts.source?.url?.startsWith('https://cptdb.ca/');
    return { url: exactPage ? verifiedFacts.source.url : searchUrl(agencyName, identity), match: exactPage ? (first === last ? 'vehicle' : 'series') : 'search', displayFleetNumber: identity, fleetRange: suffix ? `${prefix}${first}-${suffix} to ${prefix}${last}-${suffix}` : `${prefix}${first}-${prefix}${last}`, observedLive: true, ...verifiedFacts };
  }
  return { url: searchUrl(agencyName, identity), match: identity ? 'search' : 'unmatched', displayFleetNumber: identity || null, observedLive: Boolean(identity) };
}

export function matchVehiclePhoto(vehicleId, fleetFacts, agencyId = 'ttc') {
  const photo = agencyId === 'ttc' ? PHOTOS[fleetFacts?.model] : AGENCY_PHOTOS[agencyId]; if (!photo) return null;
  const id = clean(vehicleId); const depicted = fleetFacts?.model === 'FLEXITY M-1' ? ['4412'] : fleetFacts?.model === 'Xcelsior XDE60' ? ['9441'] : [];
  const knownIds = depicted.length ? depicted : photo.depictedVehicleIds ?? [];
  if (agencyId === 'go' && !knownIds.includes(id)) return null;
  return { ...photo, exactVehicle: knownIds.includes(id), ...(knownIds.length ? { depictedVehicleIds: knownIds } : {}) };
}
