# Russian 1995 Duma electoral law

Qualified runtime source: `2d5dfcf2c38621bc76519a75c1c825519ebf4b37`.

June 1995 opens an electoral-law decision after the Federal Assembly is seated. The date grants no authority. An eligible sponsor introduces a normal bill; enactment requires approval by a majority of each chamber's full capacity and presidential enactment. Rejection leaves the existing law in force and allows an explicit revised proposal.

The enacted law is frozen when a new 225-constituency plus 225-list-seat election opens. Counting, certification, handover and repeat elections preserve that authority. Campaigns already open retain their original law. The 1995 list threshold includes invalid ballots in participation; constituency turnout uses recorded issued ballots. Missing historical counters default to zero invalid ballots and observed cast ballots as the minimum observable issuance. These defaults preserve existing saves without inventing ballot records.

The historical rules use the [original 21 June 1995 electoral act](https://www.kontur-extern.ru/info/normativ/document/1/15207-federalnyy-zakon-ot-21-06-95-n-90-fz), especially articles 61, 62 and 70. The [original 6 December 1994 guarantees act](https://www.kontur-extern.ru/info/normativ/document/1/6346-federalnyy-zakon-ot-06-12-94-n-56-fz), articles 30 through 32, supplies ballot accounting without a later against-all veto. Later admission safeguards are not applied retrospectively.

The focused qualification passes 167 checks across 13 suites. Ten checks across two suites also pass against an isolated Mongo replica set, including five new actual consent journeys and five existing ordinary handover checks. The new journeys exercise both chamber rejection paths, actual bicameral approval and presidential enactment, rollback at the final journal write, concurrent attempts, completed replay, and preservation of an already-open campaign.

The successful native journey continues through candidate admission, invalid-ballot counting, a 449-seat handover and the failed constituency's repeat election to a final 450-seat Assembly. Council custody and all pre-existing financial accounts remain unchanged. A player candidate remains limited to one mandate.

| Consent/enactment journey | Commands | Request bytes | Response bytes |
| ------------------------- | -------: | ------------: | -------------: |
| Approved enactment        |        9 |          4151 |           2721 |
| Lower chamber rejection   |        2 |           752 |            542 |
| Upper chamber rejection   |        2 |           752 |            542 |
| Concurrent pair           |       19 |          8575 |           5265 |
| Completed replay          |        1 |           396 |            247 |

These measurements cover the consent/enactment shell, not the full native election phase. Scoped TypeScript, lint and formatting pass. The architecture audit reports zero blockers and 66 existing warnings. The durable transaction CI job includes the new replica-set suite.

Migration is additive: countries, bills, election rounds and tallies gain optional law authority or counters, and the new proposal journal is included in seed/reset ownership. A save without enacted authority remains under the 1993 decree. No automatic historical enactment or bulk account rewrite occurs.

This component does not change signature or party-registration prerequisites. Later 1997 through 2014 electoral laws, constitutional term changes, and a current integrated whole-world horizon remain open acceptance criteria. The local qualification proves this component's mechanics, not completion of the entire 1991 program.
