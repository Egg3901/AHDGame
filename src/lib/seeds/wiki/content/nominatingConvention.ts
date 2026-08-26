export const nominatingConventionContent = `# Presidential Nominating Convention

A presidential primary no longer ends on a single score. States vote in [staggered waves](/wiki/primaries) that hand out **pledged delegates**, and the nomination is settled by those delegates, at a convention if no one has a clear majority.

## Delegate majority

Each party has a fixed pool of delegates for the cycle (the 2020 Democratic and Republican tables, rescaled to each state's weight). The number needed to win is a simple majority:

**delegates needed = floor(total delegates / 2) + 1**

## How the nomination resolves

Once every primary wave has voted, the party's nomination is decided in one of three ways:

- **First-ballot majority.** If one candidate already holds a delegate majority, they are nominated outright. No convention is held.
- **Contested convention.** If no one holds a majority, the nomination goes to a multi-ballot convention (see below). This only applies to races running the reworked ruleset (the 1964 cycle onward).
- **Plurality (legacy races).** Races that opened under the older ruleset (including the 1960 race) skip the convention: the delegate leader is nominated directly, even without a majority.

Every tie along the way is broken the same deterministic way: more delegates, then more national primary votes, then candidate id. There is no randomness.

## The multi-ballot convention

When a contested convention runs, it proceeds ballot by ballot:

1. Each ballot counts the delegates currently pledged to every candidate still standing.
2. If the leader holds a majority of the delegates **still in play**, they are nominated and the convention ends. It also ends when only one candidate remains.
3. Otherwise the **last-placed candidate is eliminated**, and their delegates are released to the survivors.

### How released delegates move

A dropped candidate's delegates do not vanish or split evenly by default. They flow to the remaining candidates weighted by:

- **Affinity**, the same ideological and coalition closeness used for [suspended-campaign transfers](/wiki/running-mate-surrogate). A survivor who is closer to the dropped candidate receives more.
- **Endorsement**, an extra weight added to any survivor the dropped candidate had actively endorsed.

Delegates are handed out as whole numbers and always sum to exactly what was released. If every weight is zero and there is no endorsement, the delegates split as evenly as possible.

The loop repeats until someone commands a majority of the remaining delegates. Because delegates are conserved and one candidate leaves every inconclusive ballot, the convention always terminates.

## Related

- [Primaries](/wiki/primaries): the staggered delegate waves that feed the convention.
- [Election Mechanics](/wiki/election-mechanics): the overall primary and general framework.
- [Running Mate Surrogate Campaigning](/wiki/running-mate-surrogate): the affinity model also drives delegate releases.
- [General Elections](/wiki/general-elections): what happens after the nomination.
`;
