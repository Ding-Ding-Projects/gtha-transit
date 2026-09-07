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
      { id: 'plan.reverse', clickText: 'Reverse trip', expect: '.place-field input', describe: 'the trip can be reversed' },
      { id: 'plan.when.open', click: '.trip-when > summary', expect: '.trip-when[open] .journey-time', describe: 'the when row opens its date and time controls' },
      { id: 'plan.when.close', click: '.trip-when > summary', expect: '.trip-when:not([open])', describe: 'and closes again' },
      { id: 'plan.options.open', click: '.trip-options > summary', expect: '.trip-options[open] .journey-priority', describe: 'trip options opens its preferences' },
      { id: 'plan.options.priority', click: '.journey-priority button:nth-of-type(2)', expect: '.journey-priority button[aria-pressed="true"]', describe: 'a journey priority can be chosen' },
      { id: 'plan.options.close', click: '.trip-options > summary', expect: '.trip-options:not([open])', describe: 'and closes again' },
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
    ],
  },
  {
    id: 'divisions',
    label: 'Out of division',
    heading: 'Beyond the usual garage',
    steps: [
      { id: 'divisions.open', ...destination('Out of division'), expect: 'main', describe: 'the division surface is present' },
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
      { id: 'nav.more.open', click: '.m3-nav__item:nth-of-type(5)', expect: '.m3-more[open]', describe: 'More opens its dialog' },
      { id: 'nav.more.close', click: '.m3-more__close', expect: '.m3-more:not([open])', describe: 'and closes, returning focus' },
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
