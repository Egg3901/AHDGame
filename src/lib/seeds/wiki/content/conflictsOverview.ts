export const conflictsOverviewContent = `# Conflicts & the Military System

Wars in A House Divided are not a side game. They run on the same turn clock, the same treasury, the same legislature and the same character progression as everything else: a war is something your **parliament votes for**, your **treasury pays for**, your **generals fight**, and your **foreign minister eventually negotiates out of**.

This page is the map. Read it first; every other page in this category is a zoom-in on one box of the diagram below.

> **The Conflicts system is an admin-toggled subsystem.** If your world has it switched off you will see no Conflicts entry in the World menu and no Commands or Doctrine tabs in the defence office. Everything on these pages assumes it is on.

## The chain of command

Almost every mistake new players make comes from not understanding this one chain:

\`\`\`
Unit  →  General  →  Command  →  Conflict
\`\`\`

Read it right to left and it says: *a conflict is fought by commands, a command is led by generals, and a general brings the units assigned to them.*

Read it left to right and it tells you what to actually do:

1. **A unit** is assigned to **a general** by the Secretary of Defense (or your country's equivalent).
2. **A general** belongs to **a Command**, and is posted to **a Conflict** by that Command's **Commanding General**.
3. **A unit follows its general.** You never move a unit to a front directly. It is at whatever front its general is posted to, and it goes home the moment that general is unposted.

That last rule is the one that surprises people. There is no "send this division to Korea" button. There is "assign this division to General Ward", and separately "post General Ward to the Manchurian Front". The division arrives because Ward did.

A unit with no general sits in **reserve**, the homeland garrison. Reserve is always a valid place to be; every other location is a live conflict.

## What a conflict is

A **conflict** is a first-class battleground created during play. The world starts with **none**. There are no pre-seeded wars waiting on the map at a 1953 or 1979 reset: every conflict on the board was started by a player declaration or a world event.

Each conflict carries:

| Field | What it means |
| --- | --- |
| **Number** | Its public address. Conflict #3 lives at \`/world/conflicts/3\`. Numbering restarts at 1 each iteration. |
| **Host country** | Whose soil is being fought over. The host is not necessarily a belligerent: a proxy war is hosted in a country neither side is. |
| **Side A / Side B** | The two rosters of belligerent countries. Countries join and leave rosters as the war widens or as they make separate peace. |
| **War goal** | What the war was declared *for*. Peace terms negotiate against it. |
| **Control** | The share of the host's territory each side holds. This is the war's scoreboard. |
| **Region & terrain** | Derived from the host country. Terrain shapes how the fighting goes. |
| **Status** | Active, escalating, winding down, or resolved. |

A resolved conflict keeps its page forever. That is the point of the numbering: conflict #1 is a permanent historical record, browsable long after the shooting stops.

## Where everything lives

| Surface | Route | Who uses it |
| --- | --- | --- |
| **Conflicts hub** | \`/world/conflicts\` | Everyone. The world map of active wars, with casualties and who holds what. |
| **Conflict record** | \`/world/conflicts/<number>\` | Everyone, at their fog tier. The per-war page: territory, engagements, and (if you have standing) actions. |
| **Combat Command** | \`/world/conflicts/combat\` | Your nation's war room. Order of battle, unit dossiers, forecasts, declaring offensives. |
| **Defence office → Military** | Cabinet office of the defence seat | Recruit units, set postures, upgrade tech, assign units to generals, manage manpower. |
| **Defence office → Commands** | Same office | Build Commands, commission generals, declare war. |
| **Defence office → Doctrine** | Same office | Adopt national doctrine. |
| **Commanding General** | \`/country/<code>/general/commands\` | A CG only. Post your generals to conflicts; name a Theater Commander. |
| **Your profile → Military** | Your character profile | Your own general: rank, XP, trait tree, training. |
| **Executive → Foreign Affairs** | Executive shell | The head of government's war-and-peace surface. |

## Who is allowed to do what

Authority is deliberately split. No single office runs a war.

| Decision | Who may take it |
| --- | --- |
| **Declare war** | Head of government **or** the defence seat holder, then the legislature must ratify it |
| **Recruit, upgrade, set posture, assign units to generals** | The defence seat holder |
| **Commission and dismiss generals** | The defence seat holder |
| **Adopt national doctrine** | The defence seat holder |
| **Post generals to a conflict; name a Theater Commander** | The **Commanding General** of that Command |
| **Declare an offensive at a front** | The **Theater Commander** where one is named; otherwise the defence seat holder |
| **Train a general's traits** | Only that general's own player |
| **Offer or accept peace** | Head of government **or** the **foreign** seat holder |

Two of these are worth reading twice.

**Naming a Theater Commander hands away authority.** The moment a Commanding General designates a TC for a front, the defence secretary can no longer declare offensives there. That is delegation working as intended, not a bug, but it means a defence secretary who names a TC and then wonders why their declare action is blocked has simply given the job away.

**Peace is not the defence seat's call.** War is declared by the head of government or defence minister; peace is negotiated by the head of government or the **foreign** minister. A defence secretary can start a war they cannot end.

## Countries that can actually fight

Not every nation has the machinery.

- **Full participants:** a defence cabinet seat, so every control on these pages is live: US, UK, CN, DE, JP, IE, NG, RU, DD, PL, HU, RO, YU, BG, CS.
- **Read-only:** no defence seat is defined, so their forces exist and are simulated but no player can direct them: BR, BLR, BAL, FR, IT, ES, SE, TR, GR, AT, FI, SCO, WAL.

Era gating narrows this further. West Germany has **no armed forces at all in 1953**: the Bundeswehr stands up in 1955, and East Germany's NVA in 1956. A 1953 world correctly seeds those nations with zero branches rather than inventing a predecessor.

## What you can see: the three fog tiers

A conflict shows you different things depending on who you are. This is enforced on the server: the information you are not entitled to never reaches your browser at all.

| Tier | Who gets it | What you see |
| --- | --- | --- |
| **Public** | Everyone else | Territory held, cumulative casualties, per-battle verdicts and loss totals. No force composition, either side. |
| **Command** | A belligerent country's posted general, defence seat holder, or head of government | Everything public, **plus** your own live order of battle at that front, plus a coarse read of the enemy ("Stronger force", never a number). |
| **Archive** | Everyone, once the war is **resolved** | Everything, both sides, per engagement: who fought, what they lost. The fog lifts entirely for history. |

Note the shape of that: **territory and casualties are public in every tier.** The world always knows how a war is going and how many have died. Only *force composition* is secret, and only while the war is still being fought.

One deliberate gap: **incoming offensives are hidden.** You are not told that an enemy has declared an attack on you. You have to infer it from their build-up. Defending well means reading the board, not waiting for an alert.

## The turn rhythm of a war

Wars move on the hourly turn tick, in a fixed order:

1. **Force effects.** Your army's upkeep hits the budget, its power and readiness feed public safety confidence, readiness drifts toward its posture baseline.
2. **Battles resolve.** Offensives declared on an *earlier* turn fight now, against the enemy's real units as they stand at this moment.
3. **Generals accrue tenure points**, placed after battles so a general promoted by this turn's fighting is already at the new rank.
4. **Reinforcement.** Manpower regenerates and under-strength units top up in place, still under their own general.

So a turn reads: **fight → count the losses → rebuild.** A formation mauled in step 2 begins recovering in step 4 without leaving the front.

The one-turn gap between declaring and resolving is the **defender's window**. If your opponent declares on turn 500, it resolves on turn 501, and in between you can reinforce the front, reshuffle generals, or pull out entirely.

## Where to go next

**Prefer a guided route?** The [**War College**](/wiki/paths/war-college) learning path walks these pages in order (this overview, then units, generals, battle, and the full worked campaign) in about 51 minutes.

Otherwise, pick your entry point:

- New to all of this? → [Units, Recruitment & Procurement](/wiki/military-units), then [Generals & the Officer Corps](/wiki/generals).
- Want to start a war? → [Declaring War](/wiki/declaring-war).
- Want to win one? → [Fighting a Battle](/wiki/fighting-a-battle) and [Occupation, Territory & Victory](/wiki/occupation-and-victory).
- Want to end one? → [Peace, Indemnities & Truces](/wiki/peace-and-truces).
- Want to see it all put together? → [A War, Start to Finish](/wiki/a-war-start-to-finish).
`;
