export const warWalkthroughContent = `# A War, Start to Finish

Every other page in this category explains one system. This one runs a whole war through all of them, in order, with turn numbers.

It is a **hypothetical**. The characters are invented and the numbers are illustrative: the point is the sequence and the decisions, not the exact figures you will see.

**Setting:** a 1953 world. The United States declares war on China. Turn 1,000 is where we begin.

---

## The cast

| Who | Role | Country |
| --- | --- | --- |
| **President Hale** | Head of government | US |
| **Secretary Brennan** | Secretary of Defense | US |
| **Secretary Voss** | Secretary of State (foreign seat) | US |
| **Gen. Aldridge** | Commissioned general, later Commanding General | US |
| **Gen. Ruiz** | Commissioned general, later Theater Commander | US |
| **Minister Tang** | Minister of Defense | CN |
| **Prime Minister Ashford** | Head of government | UK |

---

# Act I: peacetime (turns 1,000 to 1,150)

## Brennan builds an army nobody is using yet

This is the part players skip and then lose wars over.

**Turn 1,000.** Brennan opens the defence office → **Military** tab. The US roster is its seeded order of battle. Brennan checks three things:

- **Manpower pool**: say 2.1 million against a ceiling of 3.4 million. The US sits on **Selective Service** (reserve law level 2).
- **Ministerial actions**: 4, refilling once per real day.
- **Treasury**: healthy.

He recruits. Four ministerial actions means **four formations a day, maximum**, so this takes real time:

| Day | Recruited | Manpower drawn |
| --- | --- | --- |
| 1 | 2 × Infantry Division, 1 × Armored Division, 1 × Artillery Regiment | 42,000 |
| 2 | 2 × Infantry Division, 1 × Fighter Wing, 1 × Mechanized Brigade | 30,300 |
| 3 | 1 × Marine Division, 1 × Special Forces Group, 2 × Infantry Division | 43,400 |

Each unit is unavailable for **6 turns** after ordering. Brennan is not building an army for a war next turn; he is building one for a war next week.

> **Mistake avoided:** he does not put everything on High Alert. A permanent war footing burns upkeep and erodes social cohesion at home for no benefit while nothing is happening.

## Hale and Brennan spend the doctrine points

**Turn 1,010.** Brennan opens the **Doctrine** tab. The US has the standard twelve starting doctrines and **12 points, which is all it will ever have**.

He decides the United States is a **power-projection** nation and spends deliberately:

| Adopted | Cost | Running total |
| --- | --- | --- |
| Blue-Water Navy (next node) | 3 | 3 |
| Strategic Logistics (next node) | 3 | 6 |
| Expeditionary Warfare | 3 | 9 |
| Joint Task Force | 3 | 12 |

**Twelve points, gone, permanently.** Brennan cannot undo this and neither can his successor. Every US general from now on should be training toward expeditionary logistics and joint operations, because those are the traits the nation now boosts.

> **Mistake avoided:** he does not buy one node from each category. A scattered twelve points produces a nation good at nothing.

## The officer corps

**Turn 1,015.** Brennan commissions four characters as generals, including **Aldridge** and **Ruiz**. Each arrives at Brigadier, 0 XP, **4 starting points**, nothing trained.

Crucially, **Brennan cannot spend those points.** He posts a message telling the corps what doctrine the nation adopted, and each player trains their own general.

Ruiz's player reads the doctrine list and goes down **Expeditionary Operator**, which the nation's newly adopted Expeditionary Warfare doctrine boosts. Aldridge's player takes **Staff Organizer** and **Supply-Conscious Commander**.

Between turn 1,015 and 1,150 (about five and a half real days) each general also accrues **five tenure points** (one per 24 turns). By the time war comes they have **9 points spent or banked**, not 4.

> **This is the single highest-return thing on this page.** A general commissioned five days before the war arrives more than twice as developed as one commissioned the day it starts.

## Commands

**Turn 1,020.** Brennan builds three Commands on the **Commands** tab:

| Command | Type | Regions | CG |
| --- | --- | --- | --- |
| Continental Defense | Homeland Defense | North America | (a third general) |
| Pacific Command | Regional | Western Pacific, East Asia | **Aldridge** |
| Atlantic Logistics | Logistics | North Atlantic | (a fourth general) |

Ruiz is placed in **Pacific Command** under Aldridge.

Then he assigns units. Each unit card gets an **Assign to …**: Ruiz gets the Marine Division, two Infantry Divisions, the Armored Division and the Fighter Wing. The rest go to the other generals.

He watches capacity. Pacific Command covers two regions, so its capacity is modest; he stops assigning before the panel shows an over-capacity penalty and puts the surplus under a second general in the same Command.

> **Mistake avoided:** he does not leave a Command with no commander. That is a flat 10% effectiveness penalty for nothing.

At this point **not one unit has moved.** Every one of them is in reserve, because no general is posted to a conflict: there are no conflicts. The world is at peace.

---

# Act II: the declaration (turns 1,150 to 1,180)

## Filing

**Turn 1,150.** President Hale opens the executive shell → **Foreign Affairs** tab.

- Target: **China**
- War goal: **Punitive**: extract concessions, then withdraw

He checks **Conquest** and finds it disabled. Nothing transfers territory yet, so a war for conquest could not be won on its own terms.

Filing costs **10 action points**. The panel warns him: two-thirds of votes cast, in every chamber, and no declaration for another **120 turns** afterwards whatever happens.

## The vote

The bill goes to the House with a **24-turn window**, one real day.

**This is public.** Minister Tang can see a declaration of war against China sitting on the US House floor. China has a full day to prepare, and does: Tang starts assigning units to Chinese generals and posting them.

The vote is close. Two-thirds of votes cast is a real bar, and there is no exemption: not for the US, and not for a one-party state either. **The opposition genuinely can stop this**, and in a different session it would have.

**Turn 1,174.** It passes. Hale's 10 action points are **refunded**.

## The war exists

The moment it enacts:

- **Conflict #4: "United States-China War"** is created, hosted in **China**.
- Side A: United States. Side B: China.
- Region and terrain derived from China's home region.
- **Control opens at 100**: China holds 100% of China. The US has taken nothing.
- It gets a page at \`/world/conflicts/4\`.

**Opening forces deploy automatically.** A matched slice of both sides' unassigned reserve moves to the front: both sides commit the same share, measured against whichever reserve pool is smaller, smallest formations first. Nobody is handed an army they did not build.

Hale's declaration cooldown now runs until **turn 1,294**.

---

# Act III: first contact (turns 1,180 to 1,260)

## Getting the real army to the front

The opening forces are a token. The actual campaign needs Aldridge to act.

**Turn 1,180.** Aldridge, Commanding General of Pacific Command, opens \`/country/us/general/commands\` and:

1. **Posts Gen. Ruiz to Conflict #4.** Every unit Brennan assigned to Ruiz (the Marine Division, two Infantry Divisions, the Armored Division, the Fighter Wing) arrives at the front automatically. Ruiz did not pick them and cannot; the force is derived.
2. **Designates Ruiz as Theater Commander.**

> ⚠️ **That second click just locked Secretary Brennan out.** Until now Brennan could declare offensives at this front. From this moment only **Ruiz** can. Brennan has delegated the war, and this is the intended shape, but if he did not mean it, it is a surprise.

Ruiz now also earns XP for battles at this front even when leading no units in them, at half a fighting general's rate, and their trained traits carry front-wide at a fraction of full strength to every American unit there.

## Reading the room

**Turn 1,182.** Ruiz opens the war room at \`/world/conflicts/combat\` and picks China as the target:

| Readout | |
| --- | --- |
| Projected strength | 1,340 |
| **Odds: You attack** | **44%** |
| **Odds: They attack** | **61%** |
| Supply | SUPPLIED |
| Enemy | **Evenly matched** |
| Forces | 1 nation vs 1 nation |

Ruiz reads this correctly: **44% and 61% do not add to 100, and that is the point.** Attacking is harder than defending because the defender holds the terrain. Against a comparable Chinese force, **both Ruiz and Tang can honestly see themselves under 50% as the attacker.**

The correct conclusion is *do not attack yet*. Ruiz holds.

He never sees China's order of battle, only the band "Evenly matched."

## Two more divisions

**Turn 1,190.** Ruiz messages Brennan. Brennan assigns two more Infantry Divisions to Ruiz, and because Ruiz is already posted to Conflict #4, **they arrive at the front immediately**. No separate deploy step.

**Turn 1,196.** The war room now reads **You attack: 58%**. Ruiz declares.

## The defender's window

The offensive was declared on turn 1,196 and **resolves on 1,197**. In between, Tang has a full turn.

**Tang is not told the attack is coming.** Incoming declarations are hidden by design. But Tang has been watching the front fill with American formations and correctly infers it, and posts another Chinese general with two divisions.

The 58% Ruiz acted on is now stale.

## The first battle

**Turn 1,197.** Battles resolve after force effects and before reinforcement: **fight, count losses, rebuild**.

The report:

> **Victory** · US 4,100 losses · CN 6,800 losses
> Control **100 → 97.8**

Not decisive: Tang's reinforcement saw to that. A narrow win moves the line a little; only a decisive one takes the full step.

**Ruiz earns 45 XP** for the win, plus a share for each formation they led. Their generals gain veterancy on the units that fought.

Aldridge, sitting in Pacific Command with no units at the front, earns nothing. **XP flows to whoever fought and to the Theater Commander, not up the chain.**

---

# Act IV: the grind (turns 1,260 to 1,600)

## Attrition bites

Twelve turns and four more battles later, control stands at **89**. Ruiz's army looks different:

| Unit | Strength | Veterancy |
| --- | --- | --- |
| 1st Marine Division | 61% | Veteran |
| 2nd Infantry Division | 44% | Regular |
| 3rd Armored Division | 72% | Veteran |
| 4th Infantry Division | **31%** | Green |

The 4th at 31% **fights like a formation a third its size.** Strength scaling is linear and it is the biggest single lever in the model. Ruiz's "projected strength" has fallen even though he has not lost a single unit: nothing is ever destroyed, but a ground-down army is a weak one.

## Brennan's replacement decision

Back in Washington, Brennan opens **Military → Operations** and faces the choice this whole system is built around:

| Mode | Fills per turn | Cost |
| --- | --- | --- |
| **Trained** | 10% of establishment | Preserves experience |
| **Conscript** | 25% of establishment | Arrives green: **dilutes the unit's experience by headcount** |

The US is on Selective Service, so conscription is legal.

Brennan picks **Trained**. His reasoning: the 1st Marine Division is **Veteran**, and rebuilding it from 61% with raw conscripts would blend enough green bodies in to **drop it a veterancy grade or two**. Slower rebuilding is cheaper than losing the veterans.

> **The rule to remember:** top a good formation up *early*, at 80%, when few of its people are new. Letting it fall to 30% and then rebuilding in one go is what actually destroys veterancy.

Reinforcement runs every turn, in place, at the front, still under Ruiz's command. Nobody has to come home.

## Supply turns

**Turn 1,340.** Control reaches **68**: the US now holds nearly a third of China. And the war room reads:

> Supply: **STRAINED**

This is the front punishing overextension. Supply is derived from **how far the line has moved from where it started**, and the US has moved it a long way. Deeper pushes degrade it further.

Ruiz stops attacking for twenty turns and lets the units rebuild. **Supply is derived, not accumulated.** It is not permanently lost, and if the line were pushed back the US would recover it.

This is the natural rhythm: **advance, overextend, stall, consolidate, advance.**

## Britain joins

**Turn 1,400.** Prime Minister Ashford files a UK declaration against China.

There is already a live war hosted in China, so the UK does **not** open a second one. Ashford is **enrolled on the side opposing China**: side A, alongside the US. One war per besieged country, one pin on the map.

Ashford's own 120-turn cooldown starts anyway; joining is still a full declaration.

**Turn 1,430.** A British general is posted to Conflict #4. Ruiz and the British TC both declare against China on turn 1,431.

**Turn 1,432.** The two declarations **merge into one coalition offensive.** They share a front and an attacking side, so they are one attack, on one report, with a combined roster.

China's defence pools automatically: **defenders never declare anything.** Every country with units at the front on the defending side is in the battle. Deployment *is* the consent step.

> **Verdict: Decisive Victory.** Control **68 → 63**. A decisive win takes the full step; the earlier narrow ones took a fraction of it.

## China breaks off

**Turn 1,480.** Tang's side is losing an engagement badly and **breaks off** rather than fighting it out.

The report reads:

> **Victory** · *enemy withdrew* · Control **59 → 57.5**

Three things happened:

- China **lost** the battle.
- China took **materially fewer casualties** than fighting to the end would have cost.
- The US **gained less ground** than a clean break would have given.

**Chinese units held position and kept their generals.** A retreat is not a rout off the map: the formations are still there, still commanded, and start rebuilding on the same turn.

Tang traded ground for an intact army. That is a real and often correct decision.

---

# Act V: ending it (turns 1,600 to 1,700)

## Winding down

**Turn 1,610.** Control hits **24**. The front has travelled about three-quarters of the way from its starting line, and the conflict's status flips from **Active** to **Winding Down**.

**This is public.** Everyone can see it, including Tang, and including neutrals deciding whether to intervene.

Tang reads it correctly: **the price of peace is about to go up sharply.** Right now, China still has an army and holds a quarter of its own territory. In another twenty battles it will have neither.

## Tang sues for peace

Here is where the constitutional split matters. **Tang cannot do this.** Peace is negotiated by the head of government or the **foreign** seat holder: never the defence minister who has been running the war.

China's foreign minister opens their office → **Overview** → Peace panel and offers:

| | |
| --- | --- |
| War | Conflict #4 |
| To | United States |
| Indemnity | **China pays 40,000** (quoted in China's local currency) |
| Justification | "A negotiated settlement in the interest of both peoples." |

The offer stands for **72 turns**, three real days.

Note it is addressed to **one country**. The UK is a separate belligerent and is not covered.

## Washington decides

**Turn 1,615.** Secretary of State Voss sees the offer. Only the US may accept or reject it; only China may withdraw it.

Voss weighs it honestly:

**For accepting:** the American army is at an average 55% strength and rebuilding slowly on Trained mode. Reaching control 0 needs perhaps another 20 to 25 won battles: hundreds of turns. Every one of those turns costs upkeep and manpower. And acceptance buys a **240-turn truce**, ten real days of guaranteed peace on the Pacific.

**For refusing:** China is visibly collapsing, and holding out might win outright.

**Turn 1,616.** Voss **accepts**.

What happens, in order:

1. The offer is **claimed**: no second acceptance is possible.
2. **40,000 moves** from China's treasury, converted, into the US treasury. No affordability check: the payment may push China into debt, which is what national debt is.
3. **The US stands down.** Ruiz's posting at Conflict #4 is dropped, and every American unit there returns to reserve. *(Removing the posting is what actually brings them home: clearing the location alone would just be re-derived back to a dead front.)*
4. **The US comes off side A's roster.**
5. A **240-turn truce** is recorded between the US and China.

**The war does not end.** The UK is still on side A, and Conflict #4 continues between Britain and China.

Ashford, whose army is fresh but who never raised the **Territorial and Reserve Forces Act** past its default level, now finds themselves fighting China alone, with no American logistics, a front they did not build, and a manpower pool sized for peacetime. That is the cost of joining somebody else's war.

## Britain's turn

**Turn 1,690.** Britain, unable to sustain the front alone, negotiates its own **white peace**: an indemnity of **zero**, the same mechanism dialled to nothing. It could have offered a harsher term and been refused, or accepted one and been made to pay it.

Britain was the last country on side A. **The side empties, so the war ends outright**, with China recorded as the winner. Every remaining cross-side pair is truced.

---

# After the war

**Conflict #4 is now \`resolved\`.** Its page at \`/world/conflicts/4\` survives permanently: that is the entire point of the numbering.

**The fog lifts completely, 480 turns later.** For 480 turns after the end the page reads as it did during the war: territory, casualties and verdicts for everyone, and your own rosters if you hold a belligerent seat. Then the **archive** tier opens to everyone: both sides' rosters, every engagement, who fought in each, what every formation lost. In the meantime the war sits under **Historical Conflicts** at the bottom of the conflicts hub, with its outcome, and the card says which turn the fog lifts.

The truce ledger:

| Pair | Until |
| --- | --- |
| US ↔ CN | turn 1,856 |
| UK ↔ CN | turn 1,930 |

Neither can declare on China until then, and **the truce cannot be traded away**. It is a consequence of the war ending, not a clause anyone negotiated.

The armies are home in reserve. Ruiz is a **Lt. General** now, several hundred XP richer, with promotion points spent deep in the expeditionary path. Aldridge, who commanded a Command but never held a front, gained far less.

And China, which lost the shooting and won the war, kept its army.

---

# What this walkthrough was actually showing

| Turn | Decision | Why it mattered |
| --- | --- | --- |
| 1,000 | Recruited early | 4 actions/day + 6-turn builds means armies take real weeks |
| 1,010 | Spent 12 doctrine points on one identity | Starting points are scarce, and adoption is permanent |
| 1,015 | Commissioned generals 5 days early | Tenure points more than doubled their starting capability |
| 1,020 | Left no Command commanderless | Avoided a flat 10% penalty |
| 1,150 | Filed with the votes counted | Two-thirds is real, and refusal costs 10 AP and 120 turns |
| 1,180 | Named a TC deliberately | It locked the Secretary of Defense out of the front |
| 1,182 | Did **not** attack at 44% | Attacking is harder than defending; both sides can be under 50% |
| 1,196 | Waited for two more divisions | 44% → 58% |
| 1,260 | Chose Trained over Conscript | Preserved veterancy at the cost of speed |
| 1,340 | Stopped at STRAINED | Overextension is a real penalty, and it is recoverable |
| 1,480 | China broke off | Traded ground for an intact army |
| 1,615 | Accepted a paid peace | An expensive victory 300 turns away was worth less than cash and a truce |

## The five mistakes this war avoided

1. **Building the army after the war started.** Six-turn builds and four recruits a day means you cannot.
2. **Attacking at even odds.** Terrain favours the defender; "evenly matched" is a reason to hold.
3. **Rebuilding veterans with conscripts.** Speed you do not need, for experience you cannot get back.
4. **Pushing through a supply warning.** Consolidating is not losing momentum; it is keeping an army.
5. **Fighting to a pole out of pride.** Control 24 to control 0 is another twenty-plus battles. Sometimes the cheque and the truce are the win.

## Next

- [War College](/wiki/paths/war-college): the guided reading order for this whole category.
- [Conflicts & the Military System](/wiki/conflicts-overview): the map of everything above.
- [Fighting a Battle](/wiki/fighting-a-battle): the operational loop in detail.
- [Peace, Indemnities & Truces](/wiki/peace-and-truces): the exit, in detail.
`;
