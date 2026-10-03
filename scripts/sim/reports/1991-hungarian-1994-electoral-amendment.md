# Hungarian 1994 electoral amendment qualification

Issue: #2488. Runtime source: `ccfd0195ff8c381a3e408c40f568e1612815afd0`. Executed 2026-10-03. These are bounded electoral and transaction fixtures, not whole-world acceptance.

The date opens a parliamentary decision. It does not enact the amendment. A seated deputy can introduce a bound normal bill; a formed NPC government can introduce it once when its parliamentary representation is above the proposed barrier and no human controls the government or sits in the Assembly. NPC introduction records its reason and never substitutes an automatic vote or retries a rejected bill. A legislator can revise a rejected decision, preserving the earlier bill.

The bill requires more than half the 386 deputies attending and at least two-thirds of those attending voting for it. Abstention counts as attendance. A signed bill must match its proposal identity and revision and carry the actual frozen vote snapshot before the required transaction authorizes the new law. Ordinary Hungarian bills retain their ordinary majority rule.

## Historical scope

[Act III of 1994](https://mkogy.jogtar.hu/jogszabaly?docid=99400003.TV), published 20 January, raises the list barrier to strictly more than five percent and permits three times the territorial and national list capacity in nominees. Exact five percent is excluded. National nominations increase from 116 to 174; the Assembly remains 176 constituency, 152 territorial and 58 national mandates, totaling 386. The amendment does not introduce the later 199-seat system.

The two-thirds-of-attending rule comes from section 49 of [Act XL of 1990](https://mkogy.jogtar.hu/jogszabaly?docid=99000040.TV). Quorum follows section 24(1) of the [Constitution](https://njt.jog.gov.hu/jogszabaly/1949-20-00-00).

Existing saves lacking the authorization marker retain the original law. Existing converted constitutions and completed modern settlements remain authoritative. New campaigns freeze their authorized law. Authorization can update a complete six-region primary cohort only while it is before its primary deadline, has no general ballots and has no certified count. General voting, second rounds and count receipts retain their original rules. Campaign funds, filed player identity and existing accounts are preserved.

## Verified behavior

The final focused qualification passes 108 cases across twelve suites, including portable nomination, allocation and complete mixed counts, API authorization and decision revision, three actual localized UI cases, democratic bill processing, old one-party crossover behavior, country-state recovery, projected turn reads and the reset manifest contract. Scoped integration TypeScript passes. Touched lint has zero errors, formatting passes and architecture has zero blocking findings with 66 existing warnings.

Five new real isolated-Mongo journeys pass. They exercise the actual bill engine with 386 physical seat records: 130 for and 64 against authorize at the minimum quorum; 129 for and 65 against reject; 193 for with no other attending deputies fails quorum. An injected final journal failure rolls back both authorization and cohort rebinding. Concurrent authorization applies once. Primaries containing general ballots and expired primary windows remain unchanged. Bounded NPC introduction records its reason and leaves human governments or rejected bills alone.

The complete new journey goes from parliamentary enactment through six campaign bindings, native count and whole-Assembly seating. A party at exactly five percent receives no list allocation under the new law. The certified count and handover produce 386 physical mandates while retaining all twelve existing NPC financial owners and their balances. Removing the current authorization marker afterward does not alter the already certified ballot. The existing sixteen Hungarian count, filing, vacancy and handover Mongo journeys also pass. The permanent hosted transaction job includes the new amendment suite. Synthetic databases are dropped after each case.

## Measured operations

Driver command monitoring and BSON sizes exclude fixture setup and assertions. Concurrent authorization and replay measured 29 commands, 13,874 command bytes and 16,849 reply bytes; transaction contention can produce additional retries. The complete count and handover measured 27 commands, 865,789 command bytes and 451,290 reply bytes. These are bounded operations, not whole-turn performance measurements. Reads of financial owners remain projected and no new query per deputy is introduced.

## Remaining parent criteria

Joint and linked lists, later Hungarian 2011 reform decisions and legacy candidature reconciliation remain open in #2488. Bulgarian founding and dissolution mechanics, Romanian seat transitions, Polish dissolution decisions, other country institutions, fresh source-pinned whole-world horizons and final integration promotion remain required by the broader repair program.
