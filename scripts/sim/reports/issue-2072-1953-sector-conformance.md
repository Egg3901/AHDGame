# Issue #2072: 1953 sector conformance correction

## Retained failing seed

- Sandbox database: `ahd_sim_issue2072-final-1953-e5bda323-20260930`.
- Run: `65213272-03a6-4457-a60f-73bd36bd344a`, pinned source `e5bda3237a924f91717fc271b1eeb529949cb90f`, `1953-default`, all feature flags. The run stopped at bootstrap, before turn 1.
- Persisted `seedDiagnostics` record `6abcaf84797cbb3788958a0d`: 643 okay, 21 warnings, eight criticals. The exact critical IDs were `sectors.HU.weightDist`, `PL.weightDist`, `RO.weightDist`, `YU.unowned`, `BG.weightDist`, `CS.weightDist`, `RU.unowned`, and `DD.weightDist`.

The unowned pool is optional under the authored command economy seed. RU and YU had zero unowned rows. The other six countries had an extraction-only residual unowned pool. The seeded productive sectors were instead attached to country-owned state corporations. The original diagnostic treated the residual pool as the entire economy.

## Corrected check and replay

The diagnostic now selects the country-owned SOE pool only when the command economy flag is enabled, the country has an authored budget year and SOE sector definition, and its scheduled marketization level is below `COMMAND_CEILING`. This matches the seed contract for the 1953 command economies. It requires a producing country-owned corporate sector and checks the revenue distribution across that pool plus residual unowned sectors. Market countries retain the original strict unowned requirement. A missing producing SOE remains a critical failure.

Read-only `checkSectors` replay against the retained failed seed returned **81 sector checks, zero criticals**. Producing SOE row counts were CN 42, HU 98, PL 133, RO 116, YU 136, BG 82, CS 67, RU 238, and DD 101. The eight previously critical country checks are now okay. Focused command-SOE and existing conformance tests passed: 37 tests. File-scoped ESLint and Prettier passed. This replay proves the eight bootstrap criticals were inappropriate diagnostic assertions for the saved authored seed; it does **not** prove a ten-turn 1953 nonregression.

## Evidence still required

The separate queued 1953 control `6eb27b00-62ee-444b-945e-e9e9a9a1c230` at source `ac37b0ee191089e1e1a0c501a29e691b45450211` has processed zero turns. Older completed 1953 controls use substantially different source; `0b4b1c78dccfd2afcc158392b68462463cbd0615` to this branch's parent changes 4,248 files. They cannot establish source-identical ten-turn behavior. After exact-head CI, update that queued zero-work control's source pin with a guarded queued-only compare-and-set and retain both revisions in provenance. Keep #2072 open until its actual ten-turn runtime and political acceptance are verified.
