# Naval and Air Layer

The vocabulary of the naval and air subsystem: the phases that resolve sea and sky
before a land battle is fought, and the state they leave behind. This glossary covers
this context only. Other areas of the game (trade, elections, unions, legislature) have
their own language that is not yet written down.

## The subsystem

**Naval and Air Layer**:
The set of turn phases that resolve sea and air contests and hand their results to the
land battle. Part of the war turn, not a separate game.
_Avoid_: minigame, Blue Water, navair, naval sim

**Formation**:
The unit of naval and air command. One hull group or one air wing, commanded as a whole.
_Avoid_: unit, group, squadron, stack

**Posture**:
The standing order a formation holds until a commander changes it. Persists across turns
and is what a player actually sets.
_Avoid_: mission, order, stance, assignment

## Channels

**Channel**:
One of the four named values the naval and air phases hand to the land battle. Each
enters the battle at its own point and is tuned separately.
_Avoid_: modifier, bonus, multiplier, support value

**Air Superiority**:
A side's persistent hold on the sky over one region. Decays and rebuilds across turns.
_Avoid_: air control, air dominance, air share

**Sea Control (channel)**:
A side's persistent hold on the water in one naval region. Decays and rebuilds across
turns. Distinct from the posture of the same name.
_Avoid_: naval control, sea dominance, naval reach

**Close Air Support**:
Combat weight an air formation delivers into a specific ground front this turn. The only
channel that is spent rather than held.
_Avoid_: CAS bonus, ground support, air assist

**Interdiction**:
Reduction of an enemy front's supply caused by striking behind it.
_Avoid_: supply denial, logistics strike

## Naming collisions resolved here

**Sea Control (posture) vs Sea Control (channel)**:
These are two different things and the code must not conflate them. The posture is a
choice a commander makes for one formation. The channel is a regional state both sides
contest. When ambiguous, write `SEA_CONTROL` for the posture and "sea control" for the
channel.

**Blockade vs Embargo**:
A **Blockade** is naval pressure applied to a region by formations. An **Embargo** is a
legislative or ministerial trade ban. They are separate causes that converge on the same
effect, the directed `isBlocked(commodity, exporter, importer)` predicate. Never use
"embargo" for a blockade or the trade code stops being able to say why a lane closed.

**Region vs Front vs Theater**:
A **Region** is a place on the world map and is where naval and air state lives. A
**Front** is where a land battle is fought and carries `seaAccess`. A **Theater** is one
war. Naval and air are commanded by region and only ever feed a front.

## Contest and knowledge

**Lane Closure**:
How completely a blockade has shut a sea region, from open to closed. Raises freight cost
continuously; total closure blocks the flow outright.
_Avoid_: blockade strength, embargo level, closure percent

**Detection Band**:
A discrete level of knowledge one side holds about enemy formations in a region. Gates
which postures can act against what.
_Avoid_: detection level, intel, visibility, fog

**Signature**:
How findable a formation is, set by its posture. High signature is the price of applying
pressure.
_Avoid_: visibility, stealth, profile

**Sea Access**:
Whether a front touches navigable water. A property of geography, not of force structure,
and already established by `deriveSeaAccess`.
_Avoid_: coastal, littoral, naval access
