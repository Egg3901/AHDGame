# Hungary's 1991 mixed Assembly count

Issue: #2488. Runtime source: `e1ec24859e`, based on Bulgarian ordinary Assembly merge `e3fcbefda5d92fc4a82e23915083458f45d6d874`. Executed 2026-10-02. This is bounded election qualification, not whole-world acceptance or an exact replay of historical individual candidates.

## Statutory basis

The original [1989 election act](https://njt.jog.gov.hu/jogszabaly/1989-34-00-00.0) provides 176 constituencies, 152 territorial mandates and 58 compensation mandates, including transfer of unallocated territorial mandates. The [19 November 1989 gazette correction](https://njt.jog.gov.hu/jogszabaly/1989-84-40-00) replaces the national allocation annex with D'Hondt before the 1990 election. The uncorrected act text alone is therefore insufficient. National eligibility is strictly above 4%. Territorial allocation uses the Hagenbach-Bischoff quota and strict two-thirds remainder rule, with exact fractional compensation debits.

The production rules validate all 176 constituencies and 20 county ballots, list nomination minima, seven county lists for a national filing and one mandate per individual. Constituency majorities, qualifiers, turnout, first-round losing votes and territorial reruns are counted separately. Invalid territorial second rounds retain immutable history and open genuinely renewed ballots.

The official National Election Office's 1990 county vote tables qualify the territorial allocator against its published 120 territorial mandates and the corrected national allocator against its published 90 national mandates. This verifies those allocation components, not joint-list personification or a whole historical candidate result.

## Portable sweep

Run `npx tsx scripts/sim/1991-hungarian-mixed-assembly-fixture.ts`. All 64 scenarios complete, conserving 24,704 statutory mandates: 23,296 filled and 1,408 vacant after genuinely unsuccessful constituency ballots. Each scenario gives its one player exactly one mandate. There are 58 renewed campaign stages and 160 territorial repeat ballots. No financial NPC profiles are created.

Macroregional campaign support is projected to counties using official county populations and to constituencies using equal registered electorate within each county. This is a bounded simulation convention, not literal constituency geography. Third-place qualification ties retain every tied candidate; exact quota boundary overclaims use filed ballot order. National list vacancies appear in the capital's regional capacity mirror. These conventions do not fabricate voters, extra people or financial accounts.

## Persisted and player paths

The integrated targeted run passes 140 cases across 12 suites, including eight isolated writable-replica-set Mongo journeys, 45 filing API cases and two constituency selector UI cases. The Mongo fixtures use synthetic people, explicitly loopback-only disposable databases and remove each database after the case. No live game database is read.

The persisted journeys prove 386 distinct mandate holders, each player at most one, preservation of the President and Prime Minister, frozen registration, unchanged financial balances, complete cohort custody, final-write rollback, concurrent replay, genuine second-round campaigning, first-round vote preservation, territorial repeat campaigning and scoped resolver isolation. Filing reservations serialize same-party district claims; withdrawal and re-entry reuse the same person, district, rally limits and cast votes.

The measured first-round certification plus complete handover uses 29 Mongo commands, sends 681,445 BSON command bytes and receives 311,771 BSON reply bytes. This is the bounded fixture's count and handover, not a full-turn performance result. Writes are batched and fat NPC reads project only party and office fields.

## Remaining parent acceptance

Ordinary constituency by-election refill, joint or linked list agreements, later statutory reform decisions, legacy duplicate candidature migration and source-pinned whole-world acceptance remain separate unfinished criteria in #2488. This change does not close that parent issue. Fully resolved legacy cohorts keep their outcome; unbound live cohorts migrate together and existing unfinalized tallies await the national count.
