export const occupationVictoryContent = `# Occupation, territory & victory

Winning a battle is not winning a war. A war is won by **taking ground and holding it**, one engagement at a time, over dozens of turns.

This page covers the territorial layer: the control meter, why it starts where it does, what it does to your supply, and what happens when it reaches the end.

## The control meter

Every conflict has exactly one territorial number: **control**, running 0 to 100.

It measures **the share of the host country's territory held by side B.**

- **0**: side A holds all of it.
- **100**: side B holds all of it.

That single scalar is the entire territorial state of the war. There is no per-province ledger, no list of captured cities. The map shading is *derived* from this number.

Both sides always see it. **Territory is public in every fog tier**: the world knows how a war is going, even if force compositions are secret.

## Where a war starts

This is the detail that trips people up, and it is the difference between reading the meter correctly and reading it backwards.

**A conflict opens at the host's own pole.**

| Situation | Opening control |
| --- | --- |
| The host is on side A | **0**, they hold all their own soil |
| The host is on side B | **100**, same, from the other end |
| The host is on neither side (a proxy war) | **50**, genuinely contested ground |

So **an interstate invasion opens with the defender holding 100% of their own territory**, which is exactly right: you have not invaded yet. If you declare war on China, the war is hosted in China, and China starts holding all of China.

A conflict also records the **starting line** it opened at. Almost everything below is measured from *that* point, not from the middle of the track.

## Moving the line

Every battle that produces a winner moves control toward the winner's pole.

How far depends on how decisively it was won:

- **A decisive victory takes the full step.**
- **Narrower wins scale down** in proportion to the margin. A pyrrhic victory barely moves the line at all.
- **A loser who broke off in order yields less ground** than one broken in place: an orderly retreat is genuinely better than a collapse.
- **The step does not shrink with depth.** A decisive win deep in enemy territory takes the same ground as one at the border. What makes the last stretch hard is supply, covered below, not a smaller step.
- **Defensive wins push the line back** by exactly the same rule. There is nothing special about attacking; a successful defence is territorial progress.

The territorial result and the verdict come from the same number, so they can never disagree: a Decisive Victory always moves more ground than a Pyrrhic one.

### How long is a war?

Deliberately long. A full campaign from one pole to the other needs on the order of **twenty decisive wins that go unanswered**. Narrow wins and orderly retreats take smaller slices, and every defensive win the enemy scores pushes the line back by the same rule, so a contested front runs far longer than twenty battles.

Combined with attrition, that means wars are not decided in an afternoon. You will win a battle, take a slice, discover half your divisions are at 60% strength, and have to pause and rebuild before you can push again. **The grind is the design**: see [Manpower & Conscription](/wiki/manpower-conscription) for why the pauses happen.

## Supply follows the front

Supply is not a fixed property of a side. It is **derived from how far the front has moved from its starting line**, and it is recomputed after every engagement.

- **Push forward and your supply degrades.** You are overextending: longer lines, hostile ground, a theatre you do not control.
- **Get pushed back and your supply degrades much faster.** Compression into a pocket hurts considerably more than overextension does.
- **A front that swings back recovers its supply.** This is derived, not accumulated: retake ground and your logistics improve again. Nothing is permanently lost.
- **Supply never falls to zero.** There is a floor.

Because everything is measured from the starting line, **both sides sit at their neutral baseline at kickoff**, whatever that starting line happened to be. An invader does not begin the war at minimum supply merely because they hold 0% of the defender's soil.

The war room shows your supply as **SUPPLIED · STRAINED · SHORTAGE · CUT OFF**. It is not decoration: degraded supply materially weakens your side in battle. A front that reads SHORTAGE is telling you that pushing further will make things worse, and that consolidating might be the better move.

Displacement is one input to that readout, not the whole of it. The readout is what the front can haul against what you have posted there, so a huge force at one front reads short even at the starting line. **The side fighting on its own soil hauls 25 percent more**: the nation that was declared on, and its allies at that front, have depots, rail and interior lines behind them. An invader has to bring all of that with it.

This produces the natural rhythm of a real campaign: **advance, overextend, stall, consolidate, advance again.**

## Winding down

When the front has travelled roughly three-quarters of the way from its starting line toward a pole, the conflict's status changes from **Active** to **Winding Down**.

It is a public signal that a war is approaching its conclusion, visible to everyone, including neutrals deciding whether to intervene and to the losing side deciding whether to sue for peace.

**It can reverse.** A front that swings back out of the enemy heartland returns to Active. Winding Down is a description of the current position, not a countdown.

## The front map

The conflict record and the war room both render a **front map**: the host country's real regions, shaded by who holds what.

The shading is derived from the control number: enough regions are shaded by area to cover the occupied percentage, ordered **nearest the invader first**. Where there is no geographic anchor, shading works from the periphery inward, so **the capital falls last**.

Countries with no mapped region data fall back to the meter alone.

## Victory

**Control reaching 0 or 100 ends the war.**

At that point:

1. The conflict is marked **resolved**, with the winner and a note recorded.
2. The end turn is stamped.
3. **Every belligerent stands down.** For each country, its general postings at that conflict are dropped, which returns all of their units to reserve.
4. **Truces are recorded between every cross-side pair**: 240 turns, about ten real days.
5. **The fog stays down for 480 turns, then lifts entirely.** Until then the conflict page reads as it did during the war: territory, casualties and verdicts for everyone, your own side's rosters for a belligerent's seats. Once the window lapses the page becomes an open archive: both sides' rosters, every engagement, what each formation lost. The war is listed under Historical Conflicts on the conflicts hub from the turn it ends.

Standing down works by removing the **posting**, not by clearing unit locations. Since a unit's position is a cache of its general's posting, clearing the location alone would simply be re-derived back to a dead front on the next reconcile. Removing the posting is what actually brings the army home.

### The war goal is not enforced at victory

The war goal recorded at declaration is what peace terms negotiate *against*. Reaching a pole ends the conflict on territorial grounds regardless of what was declared.

**Conquest is not currently selectable** precisely because nothing transfers territory between countries yet: a war fought for conquest could not be won on its own terms. Occupation is a wartime position, not a permanent annexation.

## The other way wars end

Territory is not the only exit. A war also ends when **one side's roster empties**: every country on it has made a separate peace and left. The last country to leave hands victory to the other side.

That is often the realistic outcome. Twenty unanswered decisive wins is a very long campaign; buying your way out is frequently cheaper than fighting to a pole. See [Peace, Indemnities & Truces](/wiki/peace-and-truces).

## Practical guidance

**Read the meter from the right end.** Control is *side B's* share. If you are side A, your progress is the number going **down**.

**Do not read a fresh invasion as "losing."** Opening at the defender's pole is the starting line, not a deficit.

**Expect to pause.** Attrition will force it. Plan reinforcement capacity (reserve law, manpower pool, replacement mode) before the campaign, not during it.

**Consolidate when supply degrades.** Pushing through SHORTAGE compounds the problem. Holding lets the front stabilise and your units rebuild.

**Defending is progress.** Every defensive win pushes the line back by the same rule an attack would. A war can be won without ever declaring an offensive.

**Being pushed back is worse than overextending.** Compression hurts supply far more. Do not let a front collapse when an orderly withdrawal is available: a loser who breaks off in order also yields less ground.

**Winding Down is a negotiating signal.** When your enemy's war goes visibly into its last quarter, that is the moment their peace offer gets cheap, or yours gets expensive.

**Never leave a front undefended.** An unopposed offensive advances at full rate. Refusing to fight does not stop the map from moving.

## Next

- [Peace, Indemnities & Truces](/wiki/peace-and-truces): the other way out.
- [Fighting a Battle](/wiki/fighting-a-battle): how to move the line.
- [A War, Start to Finish](/wiki/a-war-start-to-finish): the whole arc.
`;
