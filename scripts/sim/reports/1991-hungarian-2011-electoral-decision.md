# Hungarian later electoral-system decision qualification

Issue: #2488. Runtime source: `df4bb44bc5532ca27b23028f788b4dd212aa7524`. Executed 2026-10-03. This is bounded electoral and transaction qualification, not a whole-world simulation or complete statutory implementation.

The old calendar gate switched Hungary to the smaller Assembly in 2014 without parliamentary consent. December 2011 now opens a normal bound bill. A quorate two-thirds vote authorizes the later system, with the effective date no earlier than January 2012. Rejection leaves the earlier system in place indefinitely. The political choice preserves a sitting Assembly until a complete new ballot is counted and handed over. Existing completed modern settlements remain authoritative.

[Act CCIII of 2011](https://njt.jog.gov.hu/jogszabaly/2011-203-00-00.0) supplies the 106 constituency and 93 national-list capacities, single-round plurality, inclusive five-percent single-party list barrier, winner-surplus compensation and threefold national nomination capacity. The implemented party ballot continues the game's bounded projection of six regional campaign tallies into 106 district tallies; the regional party support baseline also supplies national-list support. These are conserved projected streams, not separately filed personal district and party-list votes. Independent candidates contest one projected district. Joint-list and minority filing remain separate parent criteria.

## Political and save behavior

Only the exact bound, signed bill with its actual frozen vote snapshot can authorize the change. Attendance must exceed half the 386 deputies and at least two-thirds of attendees must vote for it; abstention counts as attendance. Identity and revision checks protect rejected revisions and prevent another bill from authorizing the system. A formed NPC government can introduce a bill once when its party holds a two-thirds parliamentary mandate and no player controls the government or occupies an Assembly seat. The visible reason does not replace a normal vote. Rejected NPC bills are not automatically retried.

Existing complete primaries may change law only before their deadline, with no general votes, no old count receipt and no second round or constituency by-election. Binding the whole cohort updates its law and prospective capacity together in a required transaction. The scheduler preserves existing live capacities, and the country binder owns any actual law transition. Other countries retain their previous capacity-repair behavior. General voting and previously certified ballots remain under their frozen law.

New optional authorization and ballot fields leave older saves on the original system unless they already have a completed modern settlement. Such legacy settlements retain their modern resolution path. The new proposal, count and office-archive collections are classified as runtime data and cleared by world reset.

## Count and handover

The native modern receipt freezes one whole national result before any region replaces deputies. It assigns 199 distinct person identities from the existing campaign actors: players can hold one seat, while NPC nominees share existing financial owners. The original national slate remains bounded to 279 persons per eligible party. Insufficient viable people defer the count. A withdrawn direct winner leaves a vacancy; a national-list mandate uses an available unused person from the original slate while reserving every other counted winner against duplicate assignment.

Whole-Assembly seating commits all offices, financial-owner office mirrors, old office archives, player career and notice, finalized ballots and election receipts, regional capacities, the 199-seat government with majority threshold 100, shared Hungarian mandate generation and modern completion marker in one required transaction. Private balances are not copied or changed. The completion year is the actual handover year. An unavailable direct nominee cannot transfer their personal constituency win to somebody else.

## Verified cases

The final focused run passes 144 cases across seventeen suites. It covers both decision APIs, four localized control cases, old and modern counts, bounded person allocation and original-slate replacement, rejection and frozen-system dates, completion and scheduler compatibility, democratic bills, old one-party crossover behavior, projected turn reads and the reset manifest.

The combined Mongo run passes 26 cases: five new 2011 journeys, five 1994 journeys and sixteen existing Hungarian count, filing, vacancy and whole-handover journeys. The final modern suite independently passes all five after adding concurrent dispatch. It verifies actual bill enactment at the minimum quorum, two rejection cases, operative-date and general-ballot protection, and bounded NPC introduction with human and rejected-decision guards. The full normal-dispatch journey produces 106 direct and 93 national-list physical seat rows, exactly one player seat and notice, twelve original NPC financial owners with balances 12345 unchanged and the player's balance 777 unchanged. Injecting a final receipt failure rolls back all 386 incumbent replacements and the completion marker. A partial selected cohort resolves zero. Two concurrent full dispatchers return zero and six respectively, with one committed handover. Replay is empty. Synthetic databases use explicit loopback replica-set connections and are dropped afterward.

Scoped integration TypeScript passes. Every changed file passes formatting, changed-source lint has zero errors, and architecture has zero blocking findings with 66 existing warnings. The permanent hosted transaction job includes the modern suite. The final narrow status guard removes inherited runoff acceptance from modern ballots; its five Mongo journeys pass afterward. No dependencies were added.

## Operation profiles

Driver command and BSON measurements exclude fixture setup and assertions. Authorization measures 10 commands, 4279 command bytes and 3026 reply bytes. Primary-cohort binding measures 9 commands, 6606 command bytes and 5655 reply bytes. One guarded partial selection plus full normal dispatch from an already certified receipt measures 39 commands, 302538 command bytes and 594966 reply bytes. The final concurrent version of that sequence measures 74 commands, 508722 command bytes and 1395961 reply bytes, including contention retries. These are operation fixtures, not fresh full-turn profiles or whole-world performance claims.

## Remaining parent criteria

Modern post-handover constituency by-elections and party-designated list replacements require continuity qualification. Legacy duplicate candidature reconciliation, separately filed modern district/list streams, joint and linked lists and minority nominations remain open. Other country institution transitions, fresh source-pinned whole-world horizons and actual development promotion remain required by #2488 and the broader repair program. This component does not close that parent.

Additional custody qualification: all 53 normal resolver cases pass, including a bounded NPC delegation and rejection of seven mandates assigned to one player. All 18 existing native Assembly Mongo cases pass, including cancellation through both the opening scheduler and resolution after a modern Assembly takes office. The old 176-constituency scheduler cannot reopen its former chamber after a modern handover. These checks supplement the runtime-source qualification above.

The same modern-custody guard suppresses the old territorial/compensation list scheduler after handover. Three targeted real-Mongo custody cases pass, including a genuinely vacant old national-list seat that is visible before modern handover and suppressed afterward. Modern list replacement is qualified separately against its own frozen national slate.
