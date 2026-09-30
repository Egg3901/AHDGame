# Issue 2673: seed diagnostic identity qualification

This change repairs diagnostic interpretation. It does not alter seed populations, economic values or turn rules.

## Focused verification

48 tests passed across regional identity coverage and existing conformance/diagnostic suites. Cases include the seven supported national summaries, missing and orphan identities with matching totals, foreign or invented summaries, duplicate identities and national-only substrate.

## Native Mongo verification

Run `scripts/verify/issue2673-diagnostic-scope.ts` with `NODE_ENV=test` and an explicit `AHD_TEST_MONGODB_URI` for an isolated test Mongo server. The script generates and removes its own disposable database.

Four cases passed through the actual Mongo driver:

1. The full diagnostic accepts 12 UK regions plus their national summary and recognizes 50 legacy US turnout rows without country tags.
2. Replacing one valid metric with an orphan leaves total rows unchanged but reports the missing and orphan identities with 11 of 12 covered.
3. Null-country DC is recognized; unknown untagged ids do not count as US or UK turnout.
4. An explicit foreign country tag overrides a US-looking state key.

This fixture deliberately lacks other world substrate. Its unrelated critical findings are not a healthy-world qualification. No full bootstrap, world turn or hosted reset was performed.
