# Negotiated living-crisis framework acceptance (#2150)

## Scope

This report qualifies the shared engine, response authorization, public conflict surface, and telemetry. Individual crisis-family outcomes and the exact-release 1991-2027 horizon remain owned by their child issues and #2158/#2159. A completed older sandbox is reused for observability; it is not relabeled as a run of this patch or as release qualification.

## Acceptance map

| Requirement                                                                           | Evidence                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reversible lifecycle, ceasefire, failed talks, settlement, relapse, dormancy, closure | `negotiatedConflict.test.ts`, `northernIreland.test.ts`, and the existing living-conflict engine tests. Conditions drive outcomes; the added counterfactual case permits an early ceasefire and a later agreement.                                                                                                                  |
| Retry safety                                                                          | `processTurn.test.ts`, the driver retry tests, and the 2,880 real stored-state retry checks linked below.                                                                                                                                                                                                                           |
| National, cabinet, regional and party authorization                                   | POST integration cases exercise accepted and rejected national actors, cabinet portfolios, regional office location, party chairs and a minister retaining a legislative seat. Reads and submissions use the same portable policy. Existing documents without the optional portfolio restriction retain their authored role policy. |
| Missing/transformed participants                                                      | `rules/participants.test.ts` and turn integration cover reserved primary actors, authored fallbacks, active background countries, missing countries, and represented local actors. The overview now resolves the current world's participants through that same rule.                                                               |
| Vietnam/pandemic compatibility                                                        | `livingConflict.test.ts`, `pandemic.test.ts`, and `processTurn.test.ts` retain normalization and compatibility coverage. No destructive migration is introduced.                                                                                                                                                                    |
| State and transitions without covert disclosure                                       | Public view tests verify live participants, pressure windows, possible transitions, open decisions and redaction of unrevealed commitments. Submission responses use the existing visibility rule.                                                                                                                                  |
| Historical/delayed/failed/counterfactual fixture                                      | Northern Ireland engine fixtures cover the historical-shaped sequence, delay without consent, failed talks, relapse/restoration, early ceasefire and delayed agreement. These are deterministic engine fixtures, not a claimed completed referendum or historical world run.                                                        |
| Timing, overlap, decisions, damage, displacement, recovery                            | Existing-world report and saved-world recovery evidence below; `metrics.crises.test.ts` also verifies the recurring report excludes unrelated disaster interactions from living-crisis decision totals.                                                                                                                             |

## Completed world reused for telemetry

- Run `a2b5adb8-dd9a-4480-8781-50befc0fd53d`, `2027-default`, seed `audit_europe_control_2027_0929`, pure NPP actors.
- Executed source `47bb364e1f605c895d186e51f6a19b6ed4de5ff3`; completed raw turn 49, after 48 processed turns.
- Living conflicts, crisis interactions and aid bills were enabled in the retained initial manifest.
- Ten living-crisis decision windows: two each for Northern Ireland, Arab uprisings, pandemic, Russia/Ukraine security and transnational terrorism. Five opened at raw turn 2 and five at raw turn 26. Peak overlap of their authored windows is five.
- Five interactions resolved and five remained open at the endpoint. All ten interaction records are present. There were zero recorded player/leader choices in this pure-NPP run; four global windows used default outcomes. The report preserves these zeros and distinguishes them from missing records.
- The source's five opened conflicts each retain 47 elapsed conflict turns, opening year, lifecycle, phase, named tracks, and consequence totals. Damage and refugee totals are zero in this sample. This demonstrates reporting, not a successful damage/recovery scenario or correct inherited 2027 state.
- [Sanitized source observations](issue-2150-world-telemetry.json). The collector uses projected read-only queries and excludes ordinary disasters.

Reproduce with `SIM_MONGODB_URI` set to the dedicated loopback sandbox and `node scripts/sim/livingCrisisEvidence.mjs --db=<sandbox> --run-id=<run-id>`. Overlap uses authored window duration, not reconstructed early closure times. Endpoint tracks are not passed off as a recovery time series.

## Nonzero damage and recovery evidence reused

The already verified [#2152 saved-world acceptance](https://github.com/Egg3901/AHDGame/issues/2152#issuecomment-5896956941) starts from completed run `06b86bd9-2b88-41ff-b81a-4fa60f519672` at raw turn 241. Replay source `09a980d0e9bc036aee56cc2c8e285d997c11103d` is integrated through #2577. This patch does not change the conflict driver, campaign recovery or macro-output rules exercised there.

| Explicit replay branch | Turns | Settlement turn | Minimum output / baseline | Final output / baseline | Peak displaced workforce |
| ---------------------- | ----: | --------------: | ------------------------: | ----------------------: | -----------------------: |
| Saved recovery         |   720 |              96 |                    1.0000 |                  1.0000 |                       0% |
| Limited war            |   720 |              96 |                    0.8767 |                  1.0000 |                       5% |
| Broad war              |   720 |             120 |                    0.7511 |                  1.0000 |                       9% |
| Reconstruction relapse |   720 |             120 |                    0.8733 |                  1.0000 |                       9% |

These exercise the real conflict and macro-country phases against isolated copies of saved state, with peaceful responses every 24 turns and explicit counterfactual war branches. All 2,880 same-turn retries preserved state, and the unrelated AD control remained unchanged. They provide bounded damage, displacement, recovery and retry evidence for the shared engine; they are not four full-world campaigns.
