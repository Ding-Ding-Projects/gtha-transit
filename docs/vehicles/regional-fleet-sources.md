# Regional fleet additions

This source record is deliberately separate from the live vehicle matcher. It covers MiWay, Hamilton Street Railway, Burlington Transit, GO Transit, and UP Express. It does not change TTC facts or claim that a live GTFS-RT identifier belongs to a series unless the source says so.

## Capacity meanings

The record keeps `seated`, `standing`, and `total` separate. A null value means the cited source does not state that field. GO’s 55-seat D4500 and 81-seat Enviro500 figures are stored as seated counts only. The source does not establish standing space or a total-capacity definition. UP Express’s 180-passenger statement applies to a train trip, not one DMU vehicle, so all individual-vehicle capacity fields remain null. The 2013 UP Express accessibility planning report describes approximately 120 passengers for two cars and 180 for three cars, and says dedicated standing space was not planned. It is retained as planning context only, not current fleet capacity.

Hamilton’s 2020 release refers to temporary 30-customer, 40-foot and 50-customer, 60-foot operating levels. Those are service restrictions and are not reported as manufacturer capacity.

## Vehicle and photograph provenance

The HSR record has no registered photograph because the previously considered Commons asset has an unresolved creator-attribution conflict. The MiWay record is representative only because its Commons description does not name a fleet unit. Burlington’s Commons record identifies Nova Bus LFS unit 71901 as a 2019 bus, but no image is registered in the JSON until a fresh file SHA-256 receipt can be retained. GO and UP photographs are intentionally not used to assign manufacturer, year, or capacity to a live vehicle.

Photo records carry the Commons file page, direct image URL, creator, licence URL, and SHA-256 of the retrieved image bytes. No image file is stored in this repository. A photo is exact only when the documented depicted unit label equals the record’s unit label.

## Sources

- [MiWay bus at UTM IMG 6836](https://commons.wikimedia.org/wiki/File:MiWay_bus_at_UTM_IMG_6836.jpg), creator Robert T Bell, CC BY 2.0.
- [Burlington Transit 2019 NovaBus LFS 71901](https://commons.wikimedia.org/wiki/File:Burlington_Transit_2019_NovaBus_LFS_71901.jpg), creator DiltonPlayzYT, CC BY-SA 4.0.
- [Metrolinx, What’s in the GO bus fleet](https://www.metrolinx.com/en/discover/whats-in-the-go-bus-fleet), D4500, Enviro500, and D45 CRT information.
- [GO Transit, Our Vehicles](https://www.gotransit.com/en/about-go/our-vehicles), current D45 CRT fleet statement.
- [Metrolinx, differences between trains, light rail vehicles and subways](https://www.metrolinx.com/en/discover/the-differences-between-trains-light-rail-vehicles-and-subways), UP Express Nippon Sharyo DMU and 180-passenger per-trip total.
- [Metrolinx, Celebrating a decade of UP Express](https://www.metrolinx.com/en/discover/celebrating-a-decade-of-up-express), June 6, 2015 service start.
- [Metrolinx Accessibility Status Report, September 30, 2013, page 56](https://assets.metrolinx.com/image/upload/v1663237659/Documents/Metrolinx/Accessibility_Status_Report_2013_EN.pdf), planning-era two- and three-car capacity context.
- [Hamilton HSR service changes](https://www.hamilton.ca/city-council/news-notices/news-releases/service-changes-hsr), temporary 2020 operating levels.

No CPTDB page or API was queried for this record.
