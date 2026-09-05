# Roadmap

## First complete regional release

- [x] Create a public source repository and agreed deployment architecture.
- [x] Implement and test official TTC alert decoding and conservative fallback.
- [x] Test Toronto daylight-saving conversion and saved coordinate validation.
- [ ] Complete and verify every passenger flow in the built browser interface.
- [x] Build and serve a graph from all eleven validated agency feeds.
- [x] Generate local map tiles and address/place search from real regional data.
- [ ] Verify representative local and cross-agency journeys against the running engine.
- [ ] Deploy the frontend and private backend services with rollback evidence.
- [x] Owner configures the public DNS and tunnel hostname.
- [x] Retain disruption history indefinitely with calendar filtering and exports.
- [x] Make journey and per-leg ride times and kilometres prominent.
- [x] Prefer confirmed washrooms inside transit facilities only.
- [x] Complete intersection-aware search, including Warden and Highway 7.
- [x] Add live vehicle maps for six connected agencies and exact-trip assignments.
- [x] Show verified fleet details, CPTDB references and attributed photos where available.
- [ ] Connect every available official real-time feed, documenting inaccessible sources.
- [ ] Verify the public HTTPS hostname and published release.

## Later capabilities

- [ ] Broader real-time journey updates as compatible official feeds are verified.
- [ ] Auditable fare estimates and fare-rule coverage.
- [ ] Specialized/on-demand booking integrations if authorized.

- [x] Deploy shared exact/representative photo captions and licence links; verify tracker rendering at 320px and desktop widths.
- [ ] Exercise the updated caption on a live assigned-vehicle directions flow and promote validated public gallery evidence.

- [ ] Verify deployment of the attribution-corrected TTC 3539 photo and rejection of the removed URL.

## Planner reliability follow-up

- [x] Include the UP Express airport station in public Pearson search results.
- [x] Return neutral empty journey results without coordinate-based agency attribution.
- [x] Preserve distinct same-name stop locations and sort next coverage dates.
- [x] Version map tiles by the actual dataset revision, verified on both live map surfaces.
- [ ] Improve map road detail by zoom.
- [ ] Obtain consistent replacement photos for TTC XDE60 and HSR.
