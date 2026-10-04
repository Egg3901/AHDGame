# Bulgarian Grand Assembly constituency replacements

The 1990 Grand Assembly law distinguishes individual constituency replacements
from succession through original party lists. Article 80 requires scheduling
within two months of a vacancy and prevents new scheduling in the last six
months of the term. This is a scheduling restriction, so an earlier scheduled
poll may still take place after the cutoff. Article 81 requires a month's
notice and nomination closure at least 15 days before polling. Article 83
preserves the original term.

[1990 Grand Assembly election law, Articles 72, 73 and 80 to 83](https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/2132293633/issue/1081/zakon-za-izbirane-na-veliko-narodno-sabranie).

The weekly turn abstraction uses four turns of notice, three turns between
nomination closure and polling, and one turn for a runoff. Scheduling follows
vacancy discovery immediately. First-round victory requires more than half
of valid ballots and participation above half the frozen register. Otherwise
the top two proceed, or a sole unsuccessful nominee permits new filings. The
runoff uses plurality. Zero-vote repeats retain the frozen first ballot.
District registers use existing regional registration and bounded census
weights rather than claiming reconstructed historical street boundaries.

The processor runs only in an active native Grand Assembly in the 1991
preset. Founding campaigning, later ordinary Assemblies, dissolved countries
and expired terms are excluded. An earlier political decision may continue
the Grand Assembly or dissolve it; constitutional caretaker settlements cannot
open these elections. Alternate chambers without native receipts are preserved.

Existing financial NPC owners supply distinct filed people without generating
financial character clones. Party registration and home region govern
nomination. Players file one actual constituency, cannot hold another mandate,
and cannot file while relocation is pending. Party reservations serialize
concurrent filings. Renewed ballots retain immutable person identities and
carry campaign funds to the new poll without altering personal balances.

The required transaction commits elections, tallies, physical offices,
departed-stub archives, owner mirrors, player careers, notifications and journals
together. It locks country authority, chamber and original receipt. A subsequent
vacancy retains the most recent winner's financial custody even when the old
office was deleted. Ineligible winners leave a vacancy instead of awarding a
runner-up. Original 200 list mandates and the original term remain intact.
Generic NPC recruitment cannot append an unfiled person to these ballots.
Both replacement journals now have runtime reset classification. Seeded
indexes support active jobs and ordered prior-holder history.

Qualification uses synthetic 400-mandate catalogs and five financial NPC
owners against an isolated Mongo replica set. There are 193 passing cases
and one existing skipped case across eight suites, including 27 new actual
Mongo journeys and seven founding-election regression journeys. It includes ordinary majority,
actual player filing and seating, runoff, sole-candidate failure, concurrent
opening/counting/filing, 25 simultaneous vacancies, authority cancellation,
last-six-month scheduling, custody integrity, departed-holder reconciliation,
and late opening/seating rollback. No production world or queue is used.

The previously missing intact-chamber check adds four projected commands,
2,012 request bytes and 1,121 reply bytes, with no writes. One and 25 openings
both use 22 commands; one and 25 seatings both use 19 commands. Synthetic
opening replies are approximately 195 KB and seating replies 234 KB for one
or 270 KB for 25. Command count is bounded by batches, with no per-row queries.
The existing phase budgets are retained.

This qualification covers constituency replacement behavior, not complete
historical-world or release qualification. Individual virtual slate mortality
and later election reforms remain separate work.
