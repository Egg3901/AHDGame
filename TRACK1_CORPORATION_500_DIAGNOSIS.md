# Corporation detail 500 diagnosis for #2349

Checked 2026-09-25 against the restricted GlitchTip AHD project. This note
contains only error metadata and public corporation route IDs. No event user,
request headers, session data, or player payloads are retained.

## Observed production signature

- GlitchTip groups `1766` and `1765` record the same
  `TypeError: Cannot read properties of undefined (reading 'find')` on
  `GET /api/corporations/864` and `GET /api/corporations/955` respectively.
  The latest events were on 2026-09-22. The release tag is
  `eb1345194cd316759253654959bfd127c3b3c3f8`.
- Both share the same minified in-app stack frames in
  `src_lib_0enjmi3._.js`, including an `Array.map` caller. Other corporation
  routes (for example, public IDs 787 and 811) show that same signature.
  GlitchTip has no source map for these frames, so the stack does not name
  the original TypeScript line.
- Commodity and Discord endpoints also contain `find` TypeErrors in nearby
  GlitchTip groups, but the commodity stack differs. Those events are not
  evidence that the same source expression caused #864/#955.

## Code finding and patch

`loadPortfolioHoldings` mapped held bond rows and called
`bond.holders.find(...)` without a null guard. A focused mock regression
reproduces the exact TypeError when a returned row lacks `holders`; the patch
uses `(bond.holders ?? []).find(...)`, so the page can load and show zero
units for that malformed row. The UI also offers Retry after a failed load.

The query uses the dotted predicate `holders.corporationId`, which ordinarily
excludes documents without that array in MongoDB. Because the production
source map is missing and this predicate weakens the causal match, **the root
cause is not yet proven**. Keep #2349 partial until a source-mapped or
equivalent production-path reproduction confirms the failing expression and
the final candidate passes a corporation-page smoke test.

## Source-history follow-up, 2026-09-25

A real Muse Spark 1.3 read-only source investigation found a stronger match
than the portfolio guard. Release `eb1345194c` used a combined
`media_entertainment` strategy map and did not provide `media` and
`entertainment` entries. In `loadCorporationDetailView`, `buildSectorDetails`
iterates stored sectors with `sectors.map(...)`, casts each stored
`sectorType` to `CorporationType`, and calls `getEffectiveStrategyRates`.
`getStrategy` then calls `strategies.find(...)` without a runtime check. A
controlled stale-type fixture reproduced the exact `undefined.find` message
with an `Array.map` frame. The affected route's `/bonds` neighbor does not
build sector rows, consistent with the observed 200 response there.

PR #2308, merged after the failing release, restored separate `media` and
`entertainment` strategy entries in current `development`. The existing
`sectorStrategies.test.ts` exercises both persisted types. This is strong
source-history evidence for the September 22 failures, but the minified
production stack has no source map, so it remains an inference rather than a
source-line identification. A temporary combined-type row could still be
present if the short-lived product migration ran; the current source has no
`media_entertainment` strategy entry. Check the live collection through an
approved aggregate or a controlled snapshot and smoke-test #864 and #955 on
the final release SHA before declaring #2349 resolved.

An ephemeral Mongo predicate probe also showed that
`{"holders.corporationId": X}` excludes rows with missing, null, or empty
`holders`. The portfolio guard prevents a malformed mock or future query
change from crashing, but the focused mock did not reproduce the production
query path. It is not the evidenced root-cause fix.

## Cross-check against merged repair PR #2308

The merged PR's incident report confirms the causal chain rather than merely
suggesting it: the #2240 release replaced persisted `media` and
`entertainment` strategy keys before migrating production data. The owner
recorded 917 media and 500 entertainment sector rows, a corporation-turn
failure at turn 1066, and zero combined-type records in the read-only
production preflight. PR #2308 restored the two persisted types and their
strategies, added a route-level error reference and regression, and merged
later that day. This supports treating the historical crash's source defect
as repaired in current `development`. The Track 1 Retry state improves the
remaining user recovery path. The final exact-SHA smoke and issue accounting
are still required under the owner's one-pass closure rule.
