# Issue #2564: approved Japan lower-house reform

The candidate replaces the 1991 Japan lower-house allocator with its 512-seat SNTV starting rules and adds an approval-gated future transition. The portable transition rejects pre-1994, rejected and delayed proposals and accepts an approved reform idempotently. Newly created regular and snap elections freeze their law and seat split. Approval leaves current mandates and the sitting capacity unchanged; regional resolutions advance the sitting capacity using their frozen law and latest cycle.

Legal seat and district inputs come from [Act No. 10/1994](https://www.shugiin.go.jp/internet/itdb_housei.nsf/html/houritsu/12919940311010.htm) and [Act No. 104/1994, Annex I](https://www.shugiin.go.jp/internet/itdb_housei.nsf/html/houritsu/13119941125104.htm). The map retains 300 statutory constituency identifiers and Japanese municipality/ward descriptions. The 200 proportional seats are aggregated from the statutory blocs into the game's eight regions. These laws describe boundaries and legal capacities, not historical district voting observations.

Run `npx tsx scripts/sim/japanShugiinReform2564.ts` to reproduce [the controlled output](./japan-shugiin-reform-2564.json). The replay supplies each region with fixed synthetic party support of 40,000 and 10,000 votes, counts separate constituency and list ballots, and resolves the regions in the listed order. Kanto also includes a dual-filed player and a list-only player with zero personal votes.

| Region | Frozen pre-approval seats | Future constituency seats | Future list seats | Sitting capacity after regional resolution |
| ------ | ------------------------- | ------------------------- | ----------------- | ------------------------------------------ |
| HOK    | 23                        | 13                        | 9                 | 511                                        |
| TOH    | 50                        | 26                        | 16                | 503                                        |
| KAN    | 145                       | 85                        | 63                | 506                                        |
| CHU    | 86                        | 57                        | 36                | 513                                        |
| KNS    | 92                        | 47                        | 33                | 501                                        |
| CGK    | 34                        | 21                        | 13                | 501                                        |
| SHI    | 20                        | 13                        | 7                 | 501                                        |
| KYU    | 62                        | 38                        | 23                | 500                                        |

All 300 constituency and 200 list mandates are filled in this controlled scenario. The dual-filed player receives one constituency mandate and is excluded from the list allocation; the zero-personal-vote nominee receives one list mandate. Intermediate sitting capacities reflect different old and new regional maps, rather than changing every region on the approval turn.

NPP actors are bounded party representatives. One aggregate can represent distinct people across several constituency mandates and repeated list mandates after eligible player nominees. This does not model one real person holding several offices. The separate production-path regression calls `processElectionEntry`, `accumulateJapanBallots` and `resolveOneGeneralElection`: its Kanto NPC aggregate receives 85 direct and 62 list mandates, the zero-vote player receives one list mandate, and retired NPCs and stale candidate ballot IDs are excluded. Merger regressions retain already-filed district candidates and combine party list support without duplicate ranks.

Source verification passed 259 tests across 12 focused suites, covering portable rules, filing, electoral-law enactment, resolver, sitting-capacity reads, regular and snap creation, and perpetual repair. A follow-up resolver run passed all 61 tests, including five new regressions for empty-race capacity and retry after an interrupted capacity write. Empty elections advance their legal capacity even when there are no winners; failed writes restore a completed race for retry. Scoped lint and formatting pass, and the architecture audit has zero blocking findings and 70 existing warnings.

A separate opt-in real-Mongo test passed against a generated empty local database: legacy party-slot backfill, concurrent district and list-rank uniqueness, independent filings, and duplicate-key classification were exercised. Its cleanup drops only the generated database and closes the client.

This report is a controlled rules and integration check. Regional party support and the distribution of region-level votes across statutory constituencies remain game-model inputs. It does not execute a campaign-year sandbox, validate historical district vote shares, or establish political feedback calibration. Issue #2564 remains partial pending source-pinned 1991 control and treatment runs covering pre-reform and post-reform elections, and delivery through the release gate.
