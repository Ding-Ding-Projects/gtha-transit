# Live trip and vehicle follower

`LiveFollower` is a client-side panel for following one published itinerary or one explicitly selected vehicle. It is intentionally conservative: a route, headsign, timetable, or nearby position never becomes a rider vehicle assignment or a claimed next stop.

## Inputs

The component accepts a `journey`, an explicitly identified `vehicle`, or both. It supports these optional parent callbacks and values:

```ts
type LiveFollowerWashroomTarget = {
  name: string;
  etaSeconds: number;
  availability: 'confirmed-open' | 'unknown';
  note?: string;
};

type LiveFollowerProps = {
  journey?: Itinerary;
  vehicle?: LiveFollowerVehicle | null;
  onClose: () => void;
  t: (english: string, cantonese: string) => string;
  onAnnounce?: (message: { en: string; zh: string }) => void;
  onChooseVehicle?: () => void;
  onWashroomRequest?: (request: {
    position?: { lat: number; lon: number; timestamp: number };
    legIndex: number;
  }) => void;
  washroomTarget?: LiveFollowerWashroomTarget | null;
};
```

`onChooseVehicle` and `onWashroomRequest` render no control unless their parent provides a real action. The follower never substitutes a decorative button for a missing route.

## Published trip sequence

The trip timeline reads each transit leg's `from`, `intermediateStops`, and `to` values. It preserves original leg order and leg boundaries, skips walking legs for the vehicle-stop sequence, and only merges consecutive physical stops when the source supplies enough matching identity evidence. A transfer retains references to both legs even when its physical stop is displayed once.

The panel limits the rendered stop list to the first 60 published stops. It does not create a missing stop, direction, arrival time, vehicle assignment, or coordinate.

## Live vehicle position

When a vehicle identity is available, the panel reads `/api/vehicles` with that agency and vehicle ID every 20 seconds. It accepts only an exact `agencyId:id` match from the response. A matching route, headsign, or coordinate does not qualify.

Only one request runs at a time. Each request has an eight-second deadline, and unmounting or closing the panel aborts the active request and stops the poll timer. An observation is fresh for 120 seconds, stale after that, and unavailable when no usable observation timestamp exists. The UI exposes all three states.

The map follows a fresh reported vehicle position. Stale vehicle positions can remain visible but are labelled stale and do not become a new live map focus. Base tiles use the existing map tile attachment helper and no new map provider.

## Next-stop evidence and simulation

A live next stop appears only when the feed supplies explicit stop metadata whose status identifies the stop as next, upcoming, or approaching. The component does not derive a next stop from a vehicle route, headsign, schedule, or geometry.

Manual Previous, Next, and Play controls operate a clearly labelled **Simulation** preview of the published stop sequence. They are saved only for the browser session. Changing or pausing a preview stops local location tracking before the simulation changes. Simulation never creates a vehicle assignment, a publisher-confirmed stop, or an arrival prediction.

With explicit local tracking active, the panel can advance the estimated sequence only from a fresh local observation with reasonable reported accuracy that projects close to the nearby published stop geometry. It cannot move backward or skip more than two stops in one observation. The result is labelled **Estimated next stop**, never publisher-confirmed. Stale, imprecise, off-route, missing, or future observations do not advance the sequence.

## Optional browser position

The browser location control is an explicit user action. It starts a browser location watch only after activation, exposes a visible **Stop location tracking** control, and stores the latest observation in component memory only. Closing or unmounting the panel, switching to vehicle mode, changing a manual preview, and pausing or starting Simulation all clear the active watch. The final local observation remains visible as stale or stopped information rather than silently becoming a current location.

Coordinates are not sent to routing, vehicle, map, telemetry, or logging endpoints. A coordinate can leave the component only when the person explicitly selects the parent-provided washroom handoff action, and only while the local observation is fresh and reasonably accurate.

## Washroom handoff

The follower does not find facilities or calculate a facility route. A parent may provide `washroomTarget` with a supplied name, ETA, availability state, and note. The panel displays those values as supplied. If the parent provides `onWashroomRequest`, the **I need to use the washroom** action calls it with the active leg index and a location only when explicit local tracking is currently fresh and reasonably accurate.

## Accessibility and styling seams

The panel supplies semantic sections, live status text, complete text alternatives for its map, keyboard-operable buttons, and localized copy through `t`. Parent-owned CSS styles these class seams and must retain at least 44px targets, visible focus, responsive list behavior, and distinct fresh, stale, unavailable, simulation, and map-marker states:

```text
live-follower
live-follower__header
live-follower__modes
live-follower__live-state
live-follower__next
live-follower__preview
live-follower__preview-controls
live-follower__recovery
live-follower__washroom
live-follower__privacy
live-follower__map
live-follower__stops
live-follower-map-stop
live-follower-map-target
live-follower-map-vehicle
live-follower-map-person
```

## Verification

`tests/trip-progress.test.mjs` covers interleaved transit and walking legs, reverse-order itineraries, transfer-stop boundaries, stale and future observations, exact identity matching instead of route-only matching, explicit next-stop metadata, manual-preview bounds, fake-browser watch lifecycle, and conservative projection rejection for stale, future, imprecise, and off-route local observations. `npm run typecheck` checks the client component and the pure timeline utility together.
