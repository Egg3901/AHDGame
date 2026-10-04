# Monetary committee no-show cadence

Issue: #2318. Baseline: `98ffb6ded3a4110e94598e98ce582ad2c0ba9eeb`.

`scripts/sim/fomcNoShowCadence.ts` runs the authoritative governance machine for 240 turns with six seven-seat board compositions, fixed macro inputs, and an hourly clock. It imports the baseline machine when given `--baseline=<module-path>`; the control uses the actual previous implementation. It does not simulate the economy or access a database.

An irreversible majority now resolves on the next turn even when a player has not voted. A mathematically undecided motion keeps its full 24-turn or 24-hour window. Opening-turn protection, the strict full-board majority, cooldown, per-term change cap, and rate choices retain their existing rules.

| Board                                             | Control meetings/year | Treatment meetings/year | Control mean resolution turns | Treatment mean resolution turns |
| ------------------------------------------------- | --------------------: | ----------------------: | ----------------------------: | ------------------------------: |
| Six NPP hawks, one player no-show                 |                     2 |                       6 |                            24 |                               1 |
| Four NPP hawks, three player no-shows             |                     2 |                       6 |                            24 |                               1 |
| Divided NPP board, pivotal player no-show         |                     2 |                       2 |                            24 |                              24 |
| Divided NPP board, player votes after three turns |                     6 |                       6 |                             3 |                          2.9333 |
| All NPP hawks                                     |                     6 |                       6 |                             1 |                               1 |
| All players absent                                |                     2 |                       2 |                            24 |                              24 |

Macro inputs are neutral rate 5%, inflation 2%, target inflation 2%, and GDP growth 2%, with an initial prime rate of 5%. All four non-pivotal or participating scenarios execute two rate changes and finish at 5.75%. Pivotal no-shows and entirely absent boards execute zero changes and finish at 5%. The slightly earlier participating-board mean comes from one subsequent motion becoming mathematically decided before the player's scheduled ballot. Its outcomes and rate changes match the control.

The harness asserts six meetings/year and one-turn resolution for decided mixed boards, matching outcomes for participating boards, and identical results for pivotal and fully automatic boards. No meeting resolves on its opening turn. The 103 focused machine, tally, persistence-shell and turn-shell tests pass, including regressions for irreversible rejection, an undecided player ballot, deadline abstention and ballot replay.

This is scoped committee calibration. It does not establish inflation, growth or full-world balance consequences, and no live world is advanced.
