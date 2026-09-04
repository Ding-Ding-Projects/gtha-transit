# Regional transit data

`data/feeds.json` is the authoritative registry for the eleven GTHA agencies and links each feed to its official publisher. Downloaded ZIP feeds belong in the ignored `data/feeds/` directory. Validate each archive with `python scripts/data/validate-gtfs.py data/feeds/<agency>.zip`, then rebuild the local stop index with `python scripts/data/build-stop-index.py data/feeds`.

The routing service never fabricates itineraries. `/api/plan` calls the configured OpenTripPlanner GraphQL endpoint. If OTP is unavailable, the endpoint returns its bounded error. The OTP GraphQL document follows the public OTP 2 `planConnection` schema and the backend validates the response before returning it.
