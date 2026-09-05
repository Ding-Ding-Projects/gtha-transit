# Regular expression search workbench

Every mounted field supplies a unique stable `storageId`. Saved snippets are stored under that field's own key; changing field identity cannot write the previous field's snippets into the new key. The route picker uses distinct identities for agency and route search.

The transit planner's reusable search workbench pairs every eligible search field with an adjacent, anchored regular expression builder. It uses the browser's JavaScript `RegExp` dialect. Plain text is the default mode.

## Public integration contract

The workbench owns no result list and no persistent route or agency selection. The consuming field owns its state and passes an independent `SearchState` object:

```ts
import {
  SearchWorkbench,
  useSearchMatches,
  type SearchState,
} from '@/components/search-workbench';

const [routeSearch, setRouteSearch] = useState<SearchState>({
  query: '',
  pattern: '',
  flags: 'i',
  mode: 'text',
});

const labels = routes.map((route) => `${route.agency} ${route.id} ${route.name}`);
const { matches, busy, error } = useSearchMatches(labels, routeSearch);
const visibleRoutes = routes.filter((_, index) => matches[index]);

<SearchWorkbench
  label={t('Route search', '路線搜尋')}
  value={routeSearch}
  onChange={setRouteSearch}
  samples={labels}
  t={t}
/>;
```

`matches[index]` always belongs to the input at `samples[index]`. This alignment is maintained for every supplied value, including the last item in a 10,000-value route picker. A consumer must retain its own field state for each route, agency, place, or list search. Reusing one `SearchState` between fields would incorrectly make their mode, pattern, flags, and query affect one another.

`SearchWorkbench` accepts exactly these controlled props:

```ts
type SearchState = {
  query: string;
  pattern: string;
  flags: string;
  mode: 'text' | 'regex';
};

SearchWorkbench({ label, value, onChange, samples?, t });
useSearchMatches(samples, state);
```

The builder switches into regex mode by escaping the current plain-text query when no pattern has been entered. Switching back preserves the last plain-text query when available. All visible copy goes through the supplied `t(english, cantonese)` function, so the host can render English, Cantonese, or bilingual content.

## What the builder offers

The anchored popover provides:

- a plain-text-first mode switch and raw JavaScript pattern and flag fields;
- guided insertion for escaped literals, character classes, anchors, named groups, alternation, range quantifiers, positive lookahead, and positive lookbehind;
- JavaScript capability information, including explicit explanations for unavailable atomic groups, possessive quantifiers, conditionals, subroutines, and portable execution-step tracing;
- a structured token annotation that labels pattern tokens without pretending to be a complete parser;
- live bounded sample matching, a capture table, a focusable match-navigation control, and a replacement preview;
- expected-match cases that compare a user-selected expectation against the worker result;
- local saved snippets, JSON paste/file import, JSON download, and clipboard export;
- bounded static warnings for long patterns, repeated wildcards, and nested repetition.

The JavaScript engine does not expose a portable regular-expression backtracking trace. The workbench intentionally does not claim to provide one.

## JavaScript dialect and flags

The raw editor accepts the JavaScript flags `d`, `g`, `i`, `m`, `s`, `u`, `v`, and `y`. A flag may occur once. `u` and `v` are mutually exclusive. The `v` flag is reported as browser-dependent because not every JavaScript engine implements Unicode Sets. A rejected pattern, flag combination, or runtime-only capability returns an honest error state rather than falling back to a different dialect.

The supported JavaScript constructs include literal and escaped characters, character classes, anchors, groups, alternation, greedy and lazy quantifiers, named captures, and lookaround. The capability matrix remains visible for syntax that JavaScript cannot run so users do not have to discover a missing feature through a silent no-match result.

## Bounds and safety

Regex evaluation never runs in the main interface thread. `useSearchMatches` and the workbench start a new module worker at `/regex-worker.js` for a regex generation. Every request carries a request id and generation number. The caller accepts only the matching response, resets results immediately when the input changes, and terminates the worker on timeout. A result from an earlier pattern cannot replace a newer query's result.

The worker treats all caller input as bounded data:

| Value | Limit |
| --- | ---: |
| Pattern | 512 UTF-16 code units |
| Plain-text query | 512 UTF-16 code units |
| Flags | 8 characters |
| Values per filter | 10,000 |
| One route or label | 512 UTF-16 code units |
| Combined labels | 1 MiB |
| Test cases | 24 |
| One test case | 2,048 UTF-16 code units |
| Replacement template | 512 UTF-16 code units |
| Worker deadline | 150 ms |

The returned boolean array covers every admitted value. The details inspector is intentionally smaller: it returns at most 48 bounded capture records and displays only the first 12 supplied values. Those presentation limits never drop later values from the filter. The interface labels the distinction.

JavaScript cannot interrupt a catastrophic expression from inside `RegExp.test()`. The outer worker deadline is therefore the containment boundary: the browser terminates the worker realm and returns `regex-timeout`. The host should retain the previous user-visible list state only through its normal controlled rendering, never by reusing a stale `matches` array.

No network request, telemetry event, server request, or search-history write is made by the workbench. Saved snippets are stored only in local browser storage. Clearing browser storage removes them, so users can export snippets first when they want to preserve them.

## Failure states and recovery

The reusable hook returns `{ matches, busy, error }`. During a regex request, `matches` contains a new aligned false array until the current worker result arrives. The `error` value is a stable code such as `invalid-pattern`, `invalid-flags`, `pattern-too-long`, `regex-timeout`, `worker-unavailable`, or `worker-failed`. The component maps those codes to localized text. A consuming field can use the same codes with its own localization helper.

An invalid pattern does not fall back to text matching. Oversized input does not evaluate a partial prefix. A timeout does not leave a partially evaluated route page marked as complete. When a snippet import has malformed JSON, an unknown field, an oversized payload, or an unsupported value shape, the existing saved snippets remain in place.

## Keyboard and accessible interaction

The builder button sits directly beside its owning search field and reports its expanded state. It opens a non-modal dialog that remains tied to that field, has a viewport-bounded scrollable surface, focuses the raw pattern field on open, closes on <kbd>Escape</kbd>, and returns focus to the trigger. All controls use native labels and keyboard-operable inputs. The current matching state and expected-case outcome use live status text.

The component exposes semantic class hooks for the host's Material styling, including `regex-workbench`, `regex-workbench__trigger`, `regex-workbench__popover`, `regex-workbench__guided`, `regex-workbench__samples`, `regex-workbench__captures`, and `regex-workbench__cases`. The host stylesheet must keep the popover opaque, elevated, internally scrollable, and within the viewport at narrow widths and high text scaling.

## Verification

Focused coverage lives in `tests/search-workbench.test.mjs`. It runs the real worker source in an isolated worker-shaped test context and proves valid matching, named captures, zero-width safety, flag validation, invalid-pattern handling, the 10,000-value envelope, bounded payload refusal, replacement previews, expected-case checks, and the pure plain-text and snippet validators.

Run the focused check with:

```powershell
node --test tests/search-workbench.test.mjs
```

Then validate the typed React and worker integration with:

```powershell
npm run typecheck
```
