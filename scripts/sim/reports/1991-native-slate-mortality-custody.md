# Native slate financial custody during mortality

Native Bulgarian and Hungarian mandates identify distinct filed people while
using existing NPC financial actors. The generic NPC mortality processor
previously retired such an actor, minted another and repointed all its offices.
This handed potentially hundreds of individual certified mandates to an
unfiled person and left the nomination receipt referring to the retired owner.

The mortality eligibility rule now distinguishes a native slate financial
actor from an individual politician. One bounded distinct-owner lookup reads
held native Bulgarian and Hungarian mandates for otherwise eligible actors.
It does not roll their financial actor's death or mint another actor. Their
accounts, person identities, mandates, campaigns and executive references stay
intact. This guard does not add individual mortality to virtual slate people;
their lawful vacancy handling remains a separate system.

Legacy unmarked offices keep the previous death and successor behavior. The
guard ends when an actor has no remaining held native mandates. Other
countries make no additional lookup. The nomination receipts and database
types do not change.

Qualification uses 21 cases including the turn-read projection guard and seven
real isolated Mongo journeys.
Actual mortality processing preserves 400 Bulgarian and 386 Hungarian native
mandates and single-mandate owners without a roll, mint, account write,
campaign withdrawal or executive reassignment. Legacy offices still retire,
withdraw candidacy and update their PM reference to the minted successor.
A zero-seat native stub does not suppress ordinary mortality.

With the V5 gate controlled for measurement, a native actor takes two commands,
1,024 request bytes and 569 reply bytes, regardless of 1, 386 or 400 held seats.
The distinct lookup avoids the initially measured extra cursor fetch and
about 12 KB of repeated owner IDs for a full chamber. Replaying the old
processor against the actual 400-seat fixture fails the custody assertion:
it retires the owner and generates a successor using eight commands, 3,704
request bytes and 1,876 reply bytes. The former generic death
path made an insert, retirement write, office reassignment, candidacy withdrawal
and three executive-reference writes. No phase budget is increased.
