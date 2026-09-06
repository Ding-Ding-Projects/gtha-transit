/** Published series facts only. This is not a complete active-fleet inventory. */
const group = (agency, manufacturer, model, rows) => rows.map(([first,last,year,prefix='']) => ({ first,last,manufacturer,model,year:String(year),prefix,source:{url:`https://barp.ca/bus/ontario/${agency}/index.html`,title:`Barp.ca fleet photo roster: ${agency}`,retrieved:'2026-09-06',coverage:'Published series; current operating status unconfirmed'}}));
export const REGIONAL_FLEET_RANGES = Object.freeze({
  miway: [
    ...group('mississauga','New Flyer','XD40',[[1101,1143,2011],[1301,1314,2013],[1401,1407,2014],[1701,1727,2017]]),
    ...group('mississauga','New Flyer','XDE40',[[2201,2274,2022],[2301,2353,2023],[2401,2482,2024]]),
    ...group('mississauga','New Flyer','XD60',[[1351,1360,2013]]),
    ...group('mississauga','New Flyer','XDE60',[[2051,2061,2020],[2151,2155,2021],[2275,2290,2022],[2375,2396,2023]]),
    ...group('mississauga','Nova Bus','LFS',[[1730,1766,2017],[1801,1812,2018]]),
    ...group('mississauga','Nova Bus','LFS HEV',[[1901,1910,2019]]),
    ...group('mississauga','Nova Bus','LFS Artic',[[1770,1799,2017]]),
  ],
  brampton: [
    ...group('brampt','Nova Bus','LFS',[[1401,1415,2014],[1501,1519,2015],[1601,1623,2016],[1701,1713,2017],[1801,1823,2018],[1901,1916,2019],[2007,2024,2020],[2101,2108,2021],[2201,2224,2022]]),
    ...group('brampt','New Flyer','XE40',[[2152,2157,'2020-2021']]),
    ...group('brampt','New Flyer','XDE40',[[2401,2422,2024]]),
    ...group('brampt','New Flyer','XD60',[[2475,2492,2024]]),
    ...group('brampt','New Flyer','XDE60',[[1475,1484,'2013-2014'],[1575,1592,'2014-2015'],[1675,1682,2016],[1775,1785,2017],[1875,1885,2018],[1975,1976,2019],[2075,2084,2020]]),
  ],
  durham: [
    ...group('drt','New Flyer','XD40',[[8501,8515,2011],[8516,8535,2012],[8536,8543,2013],[8544,8547,2014],[8601,8626,2013]]),
    ...group('drt','Nova Bus','LFS',[[8551,8559,2015],[8560,8565,2016],[8566,8578,2017],[8579,8589,2018],[6100,6112,2018],[6113,6116,2019],[6117,6119,2021],[6136,6150,2024],[7100,7103,2018],[7104,7117,2021],[7118,7122,2022],[7123,7124,2023]]),
    ...group('drt','Nova Bus','LFS HEV',[[6120,6129,2022]]),
    ...group('drt','Nova Bus','LFS Artic',[[9100,9105,2020],[9106,9107,2021]]),
  ],
  yrt: [
    ...group('yrt','New Flyer','XD40',[[1401,1434,2014],[1801,1826,2018],[1901,1909,2019],[2206,2240,2022]]),
    ...group('yrt','New Flyer','XD60',[[2001,2028,2020],[2241,2264,2022]]),
    ...group('yrt','New Flyer','XE40',[[1911,1914,2019,'e'],[2101,2106,2021,'e'],[2201,2202,2022,'e']]),
    ...group('yrt','Nova Bus','LFS',[[1501,1518,2015],[1601,1621,2016],[1701,1715,2017]]),
    ...group('yrt','Nova Bus','LFX Artic',[[1080,1094,2010]]),
    ...group('yrt','Nova Bus','LFS Artic',[[1370,1396,2013],[1770,1774,2017],[1971,1980,2019],[2270,2295,2023]]),
  ],
});
