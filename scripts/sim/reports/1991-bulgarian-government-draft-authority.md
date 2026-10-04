# Bulgarian government constitutional draft authority

## Defect and statutory boundary

The autonomous government processor required 267 own-party NPC seats and refused
introduction if any player deputy was present. This confused introduction with
adoption and blocked minority governments and mixed chambers before a normal
vote could occur.

[Amended 1971 Constitution, Article 143](https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/516706304/issue/349/konstitutsiya-na-narodna-republika-balgariya-ot-1971-g)
gives the government an independent right of introduction. The quarter-chamber
requirement applies to collective deputy initiatives; adoption requires two
thirds of all deputies. The repair keeps the existing date gate and the
267-of-400 adoption threshold.

A portable rule separates NPC executive authority from the expected vote. It
validates mandate custody and permits player deputies and legitimate vacancies.
The government journal must be formed with an NPC PM and an existing financial
sponsor. The required opening transaction rechecks the government and sponsor:
a newly player-led or caretaker government, changed sponsor party or removed
financial owner cannot introduce through stale outer eligibility.

The existing normal bill lifecycle resolves the vote. Opening does not enact the
transition, cast player votes, change offices or move financial balances. An
existing draft is retained, and a failed vote is not silently replaced.

## Qualification

63 focused cases passed across four suites: 16 portable executive authority
cases, 13 constitutional decision regressions, 30 actual Mongo proposal/consent
journeys and four actual Mongo initiative journeys. These include:

- NPC introduction with 267, 100, one or zero own-party seats in a valid chamber,
  with player deputies present; a player PM remains responsible for introduction.
- A minority government's normal vote fails at 266 and passes at 267.
- Four changed-authority races reject stale introduction inside the transaction
  without creating a bill, proposal or transition marker.
- Duplicate introduction and failed-draft preservation, unchanged offices and
  sponsor balance, existing draft clauses, signature separation and dissolution
  vote regressions.

The old exact merged source reproduces the mixed-chamber failure: its player
case rejects introduction. The repaired source passes that case. Scoped strict
TypeScript, changed-file lint and formatting pass. Architecture has zero
blockers and 66 existing warnings.

## Turn cost

On the same synthetic 400-deputy introduction fixture:

| Source                                                    | Commands | Request bytes | Reply bytes |
| --------------------------------------------------------- | -------: | ------------: | ----------: |
| Previous introduction                                     |       18 |         8,153 |      39,178 |
| Repaired introduction with transactional authority checks |       20 |         8,951 |      29,780 |

The two added projected reads verify current government and sponsor inside the
transaction. Removing unused deputy fields lowers returned BSON by about 24%.
A player-PM rejection remains six commands, 2,402 request bytes and 1,681 reply
bytes. All deputy reads are batched; no query per deputy or phase-budget increase
is introduced. Other presets return before database work.

This is isolated module qualification, not fresh integrated 1991-to-2027 world
acceptance. #2488 and #2159 remain partial until those wider criteria are met.
