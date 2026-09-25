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
