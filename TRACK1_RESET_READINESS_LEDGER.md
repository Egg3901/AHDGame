# Track 1 reset readiness ledger

This ledger mirrors every checkbox in [#2159](https://github.com/Egg3901/AHDGame/issues/2159) as a separate `RR-###` item. The machine-readable source is [`TRACK1_RESET_READINESS_LEDGER.json`](./TRACK1_RESET_READINESS_LEDGER.json). It was seeded from #2159 as updated on 2026-09-22T04:31:39Z and code base `028cb9265e76555efa5d73b611cea0f409c3446b`.

The parent currently selects `1991-default`. The 2027-specific items remain required implementation scope even though the final launch qualification uses 1991. A later profile change requires rechecking seed-specific evidence. Checked boxes and closed child issues are claims of prior completion, not proof that the exact release candidate passes.

The owner confirmed on 2026-09-25 that the requested single final validating
worldsim **run** means one coordinated campaign containing three deterministic
seeds, a horizon run, and a release replay. No #2159 sampling gate is waived.
The seven-start working budget and each start's purpose are in
`TRACK1_EXECUTION_PLAN.md`.

On 2026-09-25 the owner approved RR-062's documented January 2027
education/income projection while the 2025 ACS 1-year release remains
unannounced. RR-062 in the JSON records the approval, impact, mitigation,
source monitoring, and rollback/rebaseline trigger. This decision clears the
external publication gate; 2027 implementation and final evidence remain
open, and the selected reset stays 1991.

RR-065 (#2289 and related 2027 country issues) records the deterministic IE
40-organization check in `8a1709776a` and HU data authored in `b0c0908742`.
The HU data is not yet wired into the roster or bootstrap. Both remain open
until exact-release persisted bootstrap and conformance evidence passes.

RR-014 (#1672) records the extracted money-flow primitive, transfer and
share-fill audit checkpoints, and the later recovery-turn-budget repair.
The receipt orphan sweep now runs outside `processTurn` with a bounded
keyset scan, an in-flight age grace, and separate cron/singleplayer drivers.
The status/ID sweep index is registered in `317153a065`; its focused test
passed, while a production-shaped explain plan is still owed.
Other money-flow consumers, integrated gates, and final campaign evidence
remain open; the GitHub issue stays `status: partial`.

| Ledger state                                | Count | Meaning                                                                               |
| ------------------------------------------- | ----: | ------------------------------------------------------------------------------------- |
| `open`                                      |    69 | Unchecked parent item; no passing release evidence recorded                           |
| `claimed_complete_pending_final_validation` |    25 | Checked in parent, but final release validation not recorded                          |
| `selected_pending_release_validation`       |     1 | Parent selects 1991; release SHA and manifest not yet frozen                          |
| `open_nonlaunch_profile`                    |     4 | 2027-specific implementation remains required; final launch qualification is for 1991 |

## Update and closure rule

For each item, record the exact command/report or source revision in `evidence`, clear `blocked_by` only when the dependency is actually satisfied, and set `final_validation.state` to `passed`, `failed`, or `waived`. A waiver needs owner approval plus impact, mitigation, monitoring, and rollback conditions. Evidence for simulations must identify source SHA, effective manifest, seed, actors, calculation/schema versions, and retained series.

Keep #2159 and linked implementation issues open during partial work. The final validation pass is the only point that resolves GitHub issues, and only if all their acceptance criteria are satisfied. Apply the selected profile, common gates, release replay, rehearsal, and completed horizon run to the exact release SHA. A closed historical child issue remains subject to release-candidate regression checks.

## Dependency order

1. Complete open implementation issues for both 1991 and 2027, then freeze the 1991 manifest and reset configuration. The crisis platform #2150 precedes #2151 through #2157 and epic #2158.
2. Prove bootstrap conformance and rehearse the reset against sandbox Mongo.
3. Run the early-world matrix, then the ten-year matrix, then the selected-profile horizon. Use targeted tests and deterministic harness runs before any full-world campaign.
4. After the final code/configuration change, replay bootstrap and the five-year matrix on the exact release SHA.
5. Validate live comparison, operations, player communication, and every remaining item. Resolve GitHub issues only after this pass.

## External dependency

The checklist also names [LSGD-ops-dash#142](https://github.com/Egg3901/LSGD-ops-dash/issues/142). Its closure and usable calibration tool require confirmation in that repository; the ledger records this independently of AHDGame issue state.
