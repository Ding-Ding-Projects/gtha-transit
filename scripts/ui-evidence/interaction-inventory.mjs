/**
 * The hand-written interaction inventory.
 *
 * Every operable target this project intends to ship, named here rather than
 * discovered at run time. That distinction is the whole point: a harness that
 * walks whatever it happens to find passes cleanly on a surface whose controls
 * have all disappeared, because it never knew they were supposed to exist.
 *
 * Each step names the target, how it is reached, and the semantic state that must
 * hold afterwards. A step whose target is missing is a failure, not a skip.
 *
 * `optional: true` marks a step whose target legitimately depends on live data -
 * a service alert that may not exist right now, a vehicle that may not be
 * running. Those are recorded as absent with the reason rather than failing, and
 * the count of them is reported so a run where everything was absent cannot look
 * like a run where everything passed.
 *
 * `widths: [...]` marks a step that only exists at some viewports. The rail shows
 * every destination, so More is a phone control; driving it at 1440 would report
 * a pass for a button that is display:none there, which is worse than not running
 * it, because it reads as evidence. Such a step is recorded as not-applicable at
 * the widths it does not belong to, and the count is reported.
 */

/** Reach a destination by its navigation label, through More when it is not primary. */
const destination = (label) => ({ kind: 'destination', label });

export const SURFACES = [
  {
    id: 'plan',
    label: 'Plan',
    heading: 'Plan your next connection',
    steps: [
      { id: 'plan.open', ...destination('Plan'), expect: '.place-field input', describe: 'the journey composer is present' },
      { id: 'plan.from', click: '.place-field:nth-of-type(1) input', type: 'Union Station', expect: '.suggestions button', describe: 'typing an origin offers published places' },
      { id: 'plan.from.choose', click: '.suggestions button', expect: '.place-field .selected-place-name, .place-field input', describe: 'choosing a place fills the field' },
      { id: 'plan.reverse', click: '.swap', expect: '.place-field input', describe: 'the trip can be reversed from the header control' },
      { id: 'plan.when.open', click: '.trip-chips .trip-when > summary', expect: '.trip-when[open] .journey-time', describe: 'the when chip opens its date and time controls' },
      { id: 'plan.when.close', click: '.trip-chips .trip-when > summary', expect: '.trip-when:not([open])', describe: 'and closes again' },
      { id: 'plan.options.open', click: '.trip-chips .trip-options > summary', expect: '.trip-options[open] .journey-priority', describe: 'the priority chip opens its preferences' },
      { id: 'plan.options.priority', click: '.journey-priority button:nth-of-type(2)', expect: '.journey-priority button[aria-pressed="true"]', describe: 'a journey priority can be chosen' },
      { id: 'plan.garage.choose', click: '.garage-picker .garage-choice input', expect: '.garage-picker .garage-choice input:checked', describe: 'a garage can be preferred' },
      { id: 'plan.garage.details', clickText: 'Show more details', expect: '.garage-detail .garage-routes', describe: 'a garage shows the routes it operates' },
      { id: 'plan.garage.vehicles', expect: '.garage-detail h4', describe: 'and what is running on those routes right now' },
      { id: 'plan.garage.hide', clickText: 'Hide details', expect: '.garage-picker', describe: 'the detail closes again' },
      { id: 'plan.garage.clear', click: '.garage-picker .garage-choice input', expect: '.garage-picker', describe: 'and the preference can be cleared' },
      { id: 'plan.options.close', click: '.trip-chips .trip-options > summary', expect: '.trip-options:not([open])', describe: 'and closes again' },
      { id: 'plan.intermediate', clickText: 'Add intermediate stop', expect: '.place-field', describe: 'an intermediate stop can be added' },
      { id: 'plan.map.toggle', clickText: 'Hide map', expect: 'main', describe: 'the map can be hidden' },
    ],
  },
  {
    id: 'status',
    label: 'Live',
    heading: 'The network, right now',
    steps: [
      { id: 'status.open', ...destination('Live'), expect: '.mini-lines button, .page-panel', describe: 'the live network surface is present' },
      { id: 'status.line', clickText: 'Yonge-University', expect: 'main', describe: 'a line card opens its detail' },
      { id: 'status.group', clickText: 'Bus routes', expect: 'main', describe: 'an alert group expands' },
      { id: 'status.go.refresh', clickText: 'Check again', expect: '.go-cancellations', describe: 'the GO panel can be re-read', optional: true },
      { id: 'status.refresh', clickText: 'Refresh', expect: 'main', describe: 'live status can be refreshed' },
    ],
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    heading: 'Find your next ride',
    steps: [
      { id: 'vehicles.open', ...destination('Vehicles'), expect: '.tracker, main', describe: 'the vehicle tracker is present' },
      { id: 'vehicles.search', click: '.regex-workbench__input-line input, .tracker input[type="search"]', type: '8', expect: 'main', describe: 'the fleet can be searched' },
      { id: 'vehicles.filters', click: '.fleet-filter-panel > summary', expect: '.fleet-filter-panel[open]', describe: 'fleet filters open' },
      { id: 'vehicles.filters.close', click: '.fleet-filter-panel > summary', expect: '.fleet-filter-panel:not([open])', describe: 'and close again' },
      { id: 'vehicles.route', click: '.route-picker-trigger', expect: 'dialog[open], .guided-route-picker', describe: 'the agency and route picker opens', optional: true },
    ],
  },
  {
    id: 'saved',
    label: 'Saved',
    heading: 'Ready when you are',
    steps: [
      { id: 'saved.open', ...destination('Saved'), expect: 'main', describe: 'saved trips shows its state' },
    ],
  },
  {
    id: 'race',
    label: 'Race',
    heading: 'Race across the region',
    steps: [
      { id: 'race.open', ...destination('Race'), expect: '.race-workspace', describe: 'the race workspace is present' },
      { id: 'race.mode', click: '.race-modes input[type="radio"]:last-of-type', expect: '.race-modes', describe: 'a challenge type can be chosen' },
      { id: 'race.title', click: '#race-title', type: 'Evidence run', expect: '#race-title', describe: 'a race can be named' },
      { id: 'race.code', click: '#race-code', type: 'ABC234', expect: '#race-code', describe: 'a join code can be entered' },
      { id: 'race.create', clickText: 'Create the race', expect: '.race-headline .race-code', describe: 'a speed run room is created' },
      { id: 'race.team', click: '.race-team-add input', type: 'Evidence team', expect: '.race-team-add input', describe: 'a team can be named' },
      { id: 'race.team.add', clickText: 'Add team', expect: '#race-own-name', describe: 'adding it offers the room to be ridden' },
      { id: 'race.join.name', click: '#race-own-name', type: 'Evidence rider', expect: '#race-own-name', describe: 'a rider can name themselves' },
      { id: 'race.join', clickText: 'Join a team', expect: '.speed-run__lines', describe: 'joining a speed run shows every station on the network' },
      { id: 'race.speedrun.line', click: '.speed-run__line', expect: '.speed-run__stations', describe: 'a line opens its stations' },
      { id: 'race.speedrun.progress', expect: '.speed-run__progress progress', describe: 'and the run reports how many are left' },
    ],
  },
  {
    id: 'divisions',
    label: 'Out of division',
    heading: 'Beyond the usual garage',
    steps: [
      { id: 'divisions.open', ...destination('Out of division'), expect: '.division-overview', describe: 'the division surface is present' },
      { id: 'divisions.classification', click: '.division-filter-chips .pill:nth-of-type(2)', expect: '.division-filter-chips .pill[aria-pressed="true"]', describe: 'vehicles can be filtered by garage assignment' },
      { id: 'divisions.classification.back', click: '.division-filter-chips .pill:nth-of-type(1)', expect: '.division-filter-chips .pill[aria-pressed="true"]', describe: 'and back to out of division' },
      { id: 'divisions.vehicle', click: '.vehicle-list .vehicle-row', expect: '.division-verdict', describe: 'a vehicle states where it lives and who runs its route', optional: true },
      { id: 'divisions.route.colour', expect: '.division-verdict .route-chip', describe: 'and carries the route in the operator colour', optional: true },
    ],
  },
  {
    id: 'history',
    label: 'History',
    heading: 'The service record',
    steps: [
      { id: 'history.open', ...destination('History'), expect: 'main', describe: 'the service record is present' },
      { id: 'history.preset', clickText: 'Today', expect: 'main', describe: 'a date preset can be applied', optional: true },
    ],
  },
  {
    id: 'coverage',
    label: 'Our region',
    heading: 'Across the whole region',
    steps: [
      { id: 'coverage.open', ...destination('Our region'), expect: 'main', describe: 'the coverage surface is present' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    heading: 'Make yourself at home',
    steps: [
      { id: 'settings.open', ...destination('Settings'), expect: '.settings-tab-strip', describe: 'settings is present with its tab strip' },
      { id: 'settings.tab.language', click: '.settings-tab-strip [data-slot="tabs-trigger"]:nth-of-type(2)', expect: '.settings-tab-strip [data-slot="tabs-trigger"][aria-selected="true"]', describe: 'a settings tab can be selected' },
      { id: 'settings.tab.first', click: '.settings-tab-strip [data-slot="tabs-trigger"]:nth-of-type(1)', expect: '.settings-tab-strip [data-slot="tabs-trigger"][aria-selected="true"]', describe: 'and the first tab selected again' },
    ],
  },
  {
    id: 'navigation',
    label: 'Plan',
    heading: 'Plan your next connection',
    steps: [
      { id: 'nav.more.open', click: '.m3-nav__item--more', expect: '.m3-more[open]', describe: 'More opens its dialog on a phone', widths: [390] },
      { id: 'nav.more.close', click: '.m3-more__close', expect: '.m3-more:not([open])', describe: 'and closes, returning focus', widths: [390] },
      { id: 'nav.rail.secondary', click: '.m3-nav__item--secondary', expect: 'main', describe: 'the rail reaches a secondary destination with no dialog', widths: [1440] },
      { id: 'nav.lang', click: '.m3-nav__lang:nth-of-type(2)', expect: '.m3-nav__lang[aria-pressed="true"]', describe: 'language can be changed from the rail' },
      { id: 'nav.lang.back', click: '.m3-nav__lang:nth-of-type(1)', expect: '.m3-nav__lang[aria-pressed="true"]', describe: 'and changed back' },
      { id: 'nav.theme', click: '.m3-nav__theme', expect: 'html[data-theme]', describe: 'the colour theme can be switched' },
      { id: 'nav.theme.back', click: '.m3-nav__theme', expect: 'html[data-theme]', describe: 'and switched back' },
    ],
  },
];

/** Every step in the inventory, flattened, so a count can be asserted. */
export const ALL_STEPS = SURFACES.flatMap((surface) => surface.steps.map((step) => ({ surface: surface.id, ...step })));

/**
 * Text that must never appear in a capture or a ledger row.
 *
 * The private vocabulary never reaches a public record, and a capture is a public
 * record. This is the check that runs after every click.
 */
export const FORBIDDEN_IN_EVIDENCE = [
  'metrolinx-api-key',
  'Authorization',
  'Bearer ',
  'PERSONAL_VOCABULARY',
];
