# Vehicle capacity source data

`data/vehicle-capacities.json` is an additive source record for a later fleet-registry integration. It makes no UI or live-vehicle assignment change.

Each `capacityDetails` object has `seated`, `standing`, `total`, `basis`, `sourceUrl`, `retrievedAt`, and `notes`. A null number means that the cited record does not support the field. It never means zero capacity.

## TTC

The [TTC Service Summary, March 15, 2026](https://cdn.ttc.ca/-/media/Project/TTC/DevProto/Documents/Home/Transparency-and-accountability/Service-Summary-2026-03-15.pdf?rev=ff632fa0a1a24466b0f13b840124fc1e) lists fleet seats, including 33 for Nova Bus LFS, 46 for Nova Bus LFS Artic, 50 for New Flyer Xcelsior XDE60, and 70 for Alstom FLEXITY M-1. It does not state standing capacity or total passenger maximum for those series, so those fields are null.

TTC separately publishes two LFLRV category records. Its [charter rates](https://www.ttc.ca/en/doing-business-with-the-ttc/chartering-ttc-vehicles/charter-rates) list 70 seated, 181 standing, and 251 maximum total. Its [2018 conventional-system statistics](https://www.ttc.ca/en/transparency-and-accountability/Operating-Statistics/Operating-Statistics---2018/Conventional-System) list 70 seated and 130 as the planned number of customers per vehicle. They are distinct records because a charter-category maximum is not a scheduled-service planning load, and the category label does not identify an exact FLEXITY M-1 series.

The TTC’s [2017 articulated-fleet safety notice](https://www.ttc.ca/news/2017/April/TTC-grounds-articulated-bus-fleet-over-safety-concern) gives a historical total of 77 seated-and-standing for 153 Nova 60-foot articulated buses. It remains separate from the current fleet-list’s 46-seat LFS Artic record because the notice does not supply a split.

## GO Transit

[Metrolinx’s GO bus fleet article](https://www.metrolinx.com/en/discover/whats-in-the-go-bus-fleet) says a D4500 can transport up to 55 passengers and an Enviro500 can transport 81 passengers. Those values are preserved as operator-published maximum passenger counts. The article does not separate seated and standing passengers, so those fields are null. The active ranges 2432-2616 and 8300-8567 are stated in the same article.

## UP Express

[Metrolinx’s vehicle explainer](https://www.metrolinx.com/en/discover/the-differences-between-trains-light-rail-vehicles-and-subways) identifies Nippon Sharyo diesel multiple units and says UP Express can carry up to 180 passengers per trip. This is train-trip capacity, not an individual vehicle specification. No individual DMU capacity field is supplied.

The source set contains no locomotive record. Locomotives are not passenger consists and must not inherit a coach or trainset capacity.
