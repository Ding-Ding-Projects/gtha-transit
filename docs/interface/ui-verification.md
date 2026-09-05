# UI capture records

The reusable helper at `scripts/ui-evidence/capture.mjs` records page-only PNG captures from a browser already launched through the required isolated headless route. It never launches a browser, removes a profile, kills a process, or changes a teardown decision. A retained process or profile leaves validation incomplete even when a termination command reported success.

## Capture operation

Use Node 22.13 or newer. Keep plans and receipts in a private task-owned run directory outside the repository. Pass a version-1 plan on standard input:

```powershell
Get-Content -Raw capture-plan.json | node scripts/ui-evidence/capture.mjs capture
```

The plan fields are:

| Field | Meaning |
| --- | --- |
| `version`, `route` | `1`, `cheap-lowlevel-headless` |
| `runRoot` | Existing task-owned private directory |
| `record`, `png`, `targetReceipt` | New relative filenames inside that directory; existing files are never replaced |
| `verifierPath` | Installed canonical `verify-headless-site/scripts/verify-edge-target.mjs` path |
| `expectedUrl`, `endpoint` | Exact public page URL and task-only `http://127.0.0.1:<port>/json/list` endpoint |
| `launch` | Original cheap headless launch `pid`, verified `edgeExecutable`, `edgeSha256`, and `edgeVersion` |
| `sourceCommit`, `buildSha256` | Full expected source commit and SHA-256 of the independently verified build output manifest |
| `viewport` | Expected CSS `width`, `height`, and display `scale` (1, 1.25, 1.5, or 2) |
| `theme`, `language`, `state` | `light` or `dark`; `en`, `zh-HK`, or `bilingual`; exact reviewed public state label |
| `resources` | Explicit `{kind,id}` inventory with every owned process, port, profile and desktop; include the static server when used |

The canonical verifier runs immediately before connecting. Its complete exact-single-target receipt is retained without rewriting and bound by SHA-256. A mismatched page, endpoint, launch identity or receipt older than 30 seconds is rejected before capture. The helper checks receipt freshness again after connecting. It cannot independently establish that the original process was launched correctly, so retain the original cheap-launch ledger alongside this record.

The helper sets `capture.startedAt` immediately before `Page.captureScreenshot` and `capture.completedAt` immediately after that request settles, including rejection. These are actual UTC request timestamps, never file observation times. Missing historical timestamps cannot be repaired retrospectively by this helper. The raw PNG is saved byte-for-byte using exclusive creation; the record remains `incomplete` until later consistency validation.

PNG checks cover signature, chunk boundaries and CRCs, header and end ordering, bounded decompression, row filters, decoded dimensions and SHA-256. The supported capture subset is non-interlaced, 8-bit grayscale/RGB with optional alpha. Animated and unsupported formats are rejected. Maximum encoded size is 32 MiB and maximum image area is 16 million pixels. Capture dimensions must equal the rounded CSS viewport multiplied by scale. Independently measure `innerWidth`, `innerHeight` and `devicePixelRatio` before the operation; physical PNG dimensions alone cannot prove the CSS tuple or page state.

## Cleanup observations and consistency validation

The caller performs approved cleanup and independently observes its actual result. Do not equate a successful termination call with process absence. Do not repeat a refused removal or weaken a guard to hide retained resources.

Write a version-1 cleanup document with a `resources` array. Each original `{kind,id}` must appear exactly once, with `status: "absent"`, an actual UTC `observedAt` at or after capture completion, and `evidence: {path,sha256}` naming a nonempty, retained, independently produced observation file inside the run root. Unknown, retained, missing or duplicate observations fail validation. Raw captures and receipts are durable evidence, not temporary resources to remove.

```powershell
# Standard input: {"runRoot":"<private run root>","record":"capture.json","cleanup":"cleanup.json"}
Get-Content -Raw validation-plan.json | node scripts/ui-evidence/capture.mjs validate
```

The validation command exits nonzero for incomplete evidence. Success returns `validated: true`, `scope: "capture-record-consistency-only"`, and always `uiVerified: false`. It checks hashes, timestamp ordering, expected source/build identifiers, exact target identity, PNG structure, resource coverage and the supplied cleanup observations. It does not observe the operating system itself, prove the supplied source/build identifiers correspond to the deployment, certify accessibility, identify sensitive pixels, or decide whether the expected state is visible. A fabricated receipt is not independent proof. Keep the raw launch, deployment, runtime, layout, accessibility and cleanup evidence and inspect the image before any promotion.

The production CLI always uses the canonical verifier and real CDP transport. The module accepts narrow transport adapters only for contract tests; those captures carry `transport: "test-injected"` and cannot pass runtime record validation. Unit tests construct separately labelled synthetic validator inputs solely to exercise schema rejection and restoration. They are not UI evidence.

## Verification

```powershell
node --test tests/ui-evidence.test.mjs
```

Focused tests cover actual helper timestamp placement, byte retention, injected-transport exclusion, missing timestamps, target mismatch/count/process/endpoint/freshness, malformed/corrupt PNGs, path containment, source binding, incomplete cleanup and retained resources. Deliberate mutations must fail, then restored inputs must pass. No browser is launched by this suite. Real UI capture, physical touch-device testing and visual inspection remain separate work.

## Privacy and failure handling

Capture plans contain local operational paths and identifiers. Never commit them or raw diagnostics. Before invoking the verifier or constructing any persisted record, the helper validates both URLs with a 4,096-character bound. It accepts only HTTP(S) page URLs without embedded credentials, queries or fragments, and a credential-free HTTP loopback target-list endpoint without queries or fragments. Current capture routes need no query or fragment; admitting them later requires a reviewed route-specific allowlist, not a list of guessed secret parameter names. Invalid URL plans throw a fixed error code and produce no record or target receipt. Their supplied values never enter command arguments or failure records.

The helper cannot determine whether a page or PNG contains private user data; use an isolated public state and review every capture. After plan validation, a failed capture retains an incomplete record where possible; a failed record write reports failure and must never be treated as successful capture evidence. Failed partial files remain in the private run directory for explicit review. Focused rejection tests use a neutral marker, assert the verifier was never invoked, check that no new files appeared, and inspect every remaining fixture file for marker absence. No real credential is used in these tests.

Suggested articles: [Interface documentation](README.md), [Project handoff](../../HANDOFF.md).
