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

const PHOTOS = Object.freeze({
  'LFS Hybrid': { url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/A_Nova_Bus_LFS_Hybrid_%282018_Version%29_of_the_Toronto_Transit_Commission_AKA_%28TTC%29.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A_Nova_Bus_LFS_Hybrid_(2018_Version)_of_the_Toronto_Transit_Commission_AKA_(TTC).jpg', credit: 'BrackishStowaway', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en' },
  'FLEXITY M-1': { url: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Flexity_Outlook_4412_TTC_Streetcar_%2827418871405%29.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Flexity_Outlook_4412_TTC_Streetcar_(27418871405).jpg', credit: 'Peter Broster', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' },
  'Xcelsior XDE60': { url: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/A_New_Flyer_Industries_XDE60_from_TTC_aka_Toronto_Transit_Commission.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A_New_Flyer_Industries_XDE60_from_TTC_aka_Toronto_Transit_Commission.jpg', credit: 'BrackishStowaway', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en' },
});

export const AGENCY_PHOTOS = Object.freeze({
  miway: { url: 'https://upload.wikimedia.org/wikipedia/commons/b/be/MiWay_bus_at_UTM_IMG_6836.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:MiWay_bus_at_UTM_IMG_6836.jpg', credit: 'Robert T Bell', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', exactVehicle: false },
  burlington: { url: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Burlington_Transit_2018_NovaBus_LFS_7036-18.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Burlington_Transit_2018_NovaBus_LFS_7036-18.jpg', credit: 'DiltonPlayzYT', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', exactVehicle: false, depictedVehicleIds: ['7036-18'] },
  hsr: { url: 'https://upload.wikimedia.org/wikipedia/commons/6/69/NovaBus_LFS_CNG_Hamilton_Street_Railway_%28HSR%29_unit_2283.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:NovaBus_LFS_CNG_Hamilton_Street_Railway_(HSR)_unit_2283.jpg', credit: 'BrackishStowaway', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', exactVehicle: false, depictedVehicleIds: ['2283'] },
  go: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/ce/Milton_GO_Train_Eastbound.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Milton_GO_Train_Eastbound.jpg', credit: 'GTDAquitaine', license: 'Public domain', licenseUrl: 'https://commons.wikimedia.org/wiki/File:Milton_GO_Train_Eastbound.jpg', exactVehicle: false, depictedVehicleIds: ['604'] },
  up: { url: 'https://upload.wikimedia.org/wikipedia/commons/6/64/Toronto_ON_UP-1012_Nippon-Sharyo-DMU_2019-04-01.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Toronto_ON_UP-1012_Nippon-Sharyo-DMU_2019-04-01.jpg', credit: 'Milan Suvajac', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', exactVehicle: false, depictedVehicleIds: ['1012'] },
});

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

export function matchVehiclePhoto(vehicleId, fleetFacts, agencyId = 'ttc') {
  const photo = agencyId === 'ttc' ? PHOTOS[fleetFacts?.model] : AGENCY_PHOTOS[agencyId]; if (!photo) return null;
  const id = clean(vehicleId); const depicted = fleetFacts?.model === 'FLEXITY M-1' ? ['4412'] : fleetFacts?.model === 'Xcelsior XDE60' ? ['9441'] : [];
  const knownIds = depicted.length ? depicted : photo.depictedVehicleIds ?? [];
  if (agencyId === 'go' && !knownIds.includes(id)) return null;
  return { ...photo, exactVehicle: knownIds.includes(id), ...(knownIds.length ? { depictedVehicleIds: knownIds } : {}) };
}
