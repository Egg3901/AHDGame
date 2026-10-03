# Bulgarian Grand Assembly list succession

The 1990 Grand Assembly election law, Articles 82 and 83, requires the next
candidate on the original list to fill a terminated list mandate for the
remaining Assembly term. Exhaustion leaves a vacancy. Article 80 provides
separate partial elections for constituency mandates.

Source: [1990 Grand Assembly election law](https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/2132293633/issue/1081/zakon-za-izbirane-na-veliko-narodno-sabranie).

The portable planner advances original list order without changing party,
district or regional allocation. Previously certified and replacement people
cannot be seated again. A player cannot acquire a second mandate; financial
NPC owners may continue to represent several distinct original people.
Initially certified list vacancies follow the same rule. Direct seats are
excluded from this processor.

The turn processor runs after the ordinary Assembly transition and before
government formation. It skips other presets, founding campaigning, expired
terms and ordinary or dissolved settlements. An alternate chamber without
native mandate receipts is preserved. Retired, missing or technocrat owners,
pending relocation, changed parties and incompatible offices exclude a nominee.

The chamber and parent receipt serialize concurrent replacements. Physical
seat IDs remain stable after departure. The required transaction commits
office replacements, departed-stub archives, owner seat counts, player career
records and notices, and the replacement journal together. Original financial
balances and prime minister mirrors remain unchanged.

Qualification uses synthetic catalogs with 200 constituency and 200 list
mandates and five existing financial owners. Forty cases include the turn-read
projection guard and 21 real
isolated Mongo journeys: intact chambers, missing and empty offices,
concurrent replacement, repeated departure, exhaustion, initially vacant
mandates, two vacancies with one eligible player, relocation and office
exclusions, PM preservation, late journal failure and historical guards.
No production data or simulation queue is used.

Before this change, no statutory list replacement ran. The intact-chamber
path adds three projected commands, 1,464 request bytes and 859 reply bytes,
without writes. A replacement uses 15 commands with a deleted office or 17
with an archived empty stub. The synthetic native catalog and chamber return
about 326 KB only when vacancies exist. Frozen ballot payloads are projected
out: an extra 2 MB receipt payload does not increase reply size above 500 KB.
There are no per-row queries, and the existing phase budget is retained.

This component does not implement constituency partial elections or individual
mortality for virtual slate people. Those remain separate institution work,
along with full-world qualification and release promotion.
