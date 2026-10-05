# Conserved reception and initial services, issue #2554

The actual Yugoslav reception choice now claims a named population order with the leader's response. The next demographic turn transfers identical age and sex cells from current origin regions to the host, then freezes the vectors, population totals, readouts and realized reception result in one resumable flow plan. History and response completion finish before the population receipt completes. A failed response request after its claim cannot lose its order.

Run `npx tsx scripts/sim/refugeeReception2554.ts` from the repository root. The fixture starts an owned disposable Mongo process, verifies its process identity before writes, uses random private database names, and drops its databases and stops the owned process afterward. It runs the actual response shell, demographic phase, recovery, federal spending formula and treasury processor. The adjacent JSON records the exact source hashes and results.

## Authored model and gates

The leader requests up to 0.3% of the host population. Each region's residual allowance shares the existing 1.5% annual international migration cap across 48 turns with ordinary migration. Available source cohorts further limit movement, and the modeled sex-specific conscript stock is reserved within its eligible age band. Endpoints use current sovereign ownership; a retired origin is not replaced with an unauthorized successor. Active conflict displacement is required as a condition, without converting its 0 to 100 score into a population count.

The sovereign response supplies corridor permission. The latest unrepealed national law for each recognized seven-option asylum or border catalog narrows permission with multipliers 1, 1, 0.75, 0.5, 0.25, 0.1 and 0. The most restrictive active type applies. Unknown enacted options fail closed. Countries without a modeled asylum law use the leader's explicit response. Law permission is frozen with that one-shot choice; subsequent choices use subsequent laws. Decisions made during a turn defer beyond its current target, and an unmaterialized corridor expires after 24 turns.

Initial service cost per person is 20% of the host's GDP per person annually, frozen at admission authorization. Support lasts 24 turns from actual reception. The unchanged ordinary treasury processor accrues the resulting national spending line; reception adds no separate cash debit. At the full requested 0.3% host share, six months of support equals the previous 0.03% GDP upfront charge before rounding. Migration and cohort limits can admit fewer people, so actual spending falls proportionally. These admission, law, cost and duration values are gameplay assumptions requiring world calibration, not historical estimates.

The fixed Yugoslav host participation penalty and the reception option's GDP-growth tick are removed. Countries that seal their frontier no longer receive those reception charges. Other crisis pressure and physical-damage exposure remain separate. Covert response serialization also hides the new order and result until exposure.

## Controlled results

Two synthetic regions begin with 100,000 residents each. The open host requests 300 people, receives 31.25 under the existing per-turn cap, and owes 62,500 local currency units of annual initial services. Actual treasury cash over the 24 support turns is 31,248 after whole-unit rounding; repeated processing of each treasury turn adds zero cash charge. The spending line expires on turn 32 for an arrival on turn 8.

Injected failures occur after a partial cohort write, after reception history lands, after response completion lands, and before final population receipt completion. Each recovery equals uninterrupted reception, conserves total population against the actual no-response control, leaves one history entry and completes the response outbox. Completed population replay does not create a second transfer or service obligation.

Sealed-frontier, zero-displacement, expired-corridor and closed-law controls receive zero people and create zero service cost. The open-law control receives 31.25. Germany's neighbor role is synthetic in the law fixtures; this is not a claim about its canonical Yugoslav response role or a whole-world experiment.

The uninterrupted demographic phase with one order uses 35 commands, 22 reads and 14,981 reply BSON bytes. Recovery intentionally performs additional confirmation reads. Preparation adds five projected reads for the host's clock, regions, fiscal base, laws and conflict condition. Budget refresh adds one shared world read and one projected active-obligation read for all countries, not a history query per country. Index creation is once per database handle. These are small fixture costs, not full-world performance evidence.

## Schema and remaining acceptance

The new optional response order/result and interaction outbox fields apply to new responses. Existing historical responses are not backfilled into population movements. Reception history is a runtime collection cleared by reset; pending-order and active-service indexes are created lazily. The reset-unique identity and demographic journal lifecycle are described in `demographic-flow-replay-2554.md`. Reset must stop turn processing; concurrent reset writes remain unsupported.

Initial service caseload is an obligation measured from received people. It does not trace subsequent individual mortality, internal movement or repatriation. Professional military personnel without cohort attribution are not separately reserved by this model. Typed casualties, actual capacity destruction, funded repair, returns and a source-pinned 1991 world comparison remain open. This report does not complete #2554 or authorize its closure.
