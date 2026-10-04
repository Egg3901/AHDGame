# First Russian Duma rules qualification

Run `node --import tsx scripts/sim/1991-russian-duma-fixture.ts` from the repository.
This fixture never connects to a database and is not a full-world qualification.

The run passes 768 matched-seed scenarios: 64 preference vectors, four valid-ballot
turnout levels (24%, 25%, 50%, 100%) and three against-all shares (0%, 10%, 90%).
List ballots produce 384 elected results and 384 required repeats. Each elected
result preserves exactly 225 list mandates. The numbered 225 constituency plans
preserve every regional registered voter and district identity. Their boundaries
are within the game's macroregions and do not reproduce the historical map.

Assertions cover the quarter-register valid-ballot quorum, the five-percent list
gate including against-all ballots in its denominator, exact Hare remainders,
iteration-order independence, bounded NPC nominee capacity, one mandate per
player, and exclusion of successful constituency players from list seating.

The original October decree excludes lists below five percent; the implementation
therefore admits a list exactly at five percent. Equal list remainders prefer
more votes, then earlier registration. Constituency ties prefer earlier
registration. The November amendment replaces the earlier constituency
against-all veto with the valid-ballot quorum and calculates the list quota
using votes for admitted lists.

Sources: [October 1993 Central Election Commission bulletin](https://xn--90aiawao7a1fl.xn--80abliecoqdpqeu7c.xn--p1ai/1993/1/),
[Decree 1846 of 6 November 1993](https://normativ.kontur.ru/document/1/2553-ukaz-prezidenta-rf-ot-06-11-93-n-1846),
and [IPU first-Duma election summary](https://data.ipu.org/election-summary/HTML/2263_93.htm).

This report qualifies the portable district, ballot and nominee rules. It does
not establish live turn wiring, owner eligibility, transaction rollback, office
seating, Federation Council elections, recurring cycles or full-world effects.
Those require their own implementation and qualification before release.
