# Issue #3471: JP Shūgiin proportional seats and 10% threshold

The candidate replaces the 1991 game's candidate-limited Shūgiin allocation with the same proportional Hare path used by the modern JP lower chamber. Regular and snap races use a party-pooled 10% eligibility threshold. Independents remain individual eligibility groups. The post-1994 mixed system applies the same threshold to its regional D'Hondt list tier.

The user-provided screenshots show Chugoku projecting 1 of 34 seats from a sole player candidate with 100% of the vote, and Tohoku projecting 5 of 50 seats from five player candidates.

Run `npx tsx scripts/sim/japanShugiinProportional3471.ts` to reproduce [the controlled output](./issue-3471-jp-shugiin-proportional.json). The simulation feeds aggregate versions of the screenshot Chugoku and Tohoku vote shapes through the production portable rules, then exercises the 10% boundary in both the Hare and mixed-system D'Hondt paths.

| Scenario                             | Seats | Former filled | Candidate filled | Allocation                                                       |
| ------------------------------------ | ----: | ------------: | ---------------: | ---------------------------------------------------------------- |
| Screenshot Chugoku shape             |    34 |             1 |               34 | sole eligible party 34                                           |
| Screenshot Tohoku shape              |    50 |             5 |               50 | two eligible parties 25 each; three sub-threshold independents 0 |
| Hare threshold: 89% / 10% / 1%       |    34 |           n/a |               34 | 31 / 3 / 0                                                       |
| Mixed list threshold: 89% / 10% / 1% |    16 |           n/a |               16 | 15 / 1 / 0                                                       |

The perpetual-election healer converts active and upcoming pre-reform JP races to the era's proportional method. The shared allocator also interprets a still-frozen JP Shūgiin `sntv` snapshot through the proportional path, so rollout order cannot make the live projection and final resolution diverge.

This is a bounded allocation report, not a campaign trajectory. It qualifies seat conservation, threshold boundaries, live-shape compatibility, and projection/resolution parity. It does not claim historical district realism or measure later coalition and policy feedback.
