export const militaryCommandsContent = `# Commands & Command Structure

A **Command** is the organisational layer between your cabinet and your battlefield. It is where the Secretary of Defense stops being the person who moves every division personally and starts being the person who appoints the people who do.

This is the most administrative page in this category, and the one that decides whether your war is run by one overworked minister or by a functioning general staff.

## Why Commands exist

Without Commands, the defence seat holder does everything: recruits, assigns, posts, declares. That works for one small war and collapses for anything larger.

A Command lets you **delegate**. You build the structure; you appoint a **Commanding General** to run it; they post their generals to fronts and name **Theater Commanders**; those TCs run the actual fighting. Each layer has real authority the layer above genuinely gives up.

The full chain:

\`\`\`
Secretary of Defense
  builds Commands, commissions generals, assigns units
        ↓
Commanding General  (one per Command)
  posts the Command's generals to conflicts
  designates a Theater Commander for each front
        ↓
Theater Commander  (one per conflict)
  declares and withdraws offensives at that front
\`\`\`

## Building a Command

Defence office → **Commands** tab → *Create command*. A confirmed defence seat holder or an acting one may build and reorganise commands; only a confirmed holder may commission or dismiss the generals that fill them.

A Command has:

| Field | What it does |
| --- | --- |
| **Name** | Yours to choose. |
| **Type** | Homeland Defense, Regional, or Logistics. |
| **Regions** | Which strategic regions it is responsible for. Up to **3** for Homeland Defense and Regional commands; uncapped for Logistics. |
| **Posture** | One of twelve standing postures. |
| **Supply priority** | Normal, High, or Emergency. |
| **Commanders** | Which of your commissioned generals belong to it. |
| **Commanding General** | Which one of them leads it. |

### The three types

| Type | Character |
| --- | --- |
| **Homeland Defense** | Home defence, air-defence integration, faster reserve mobilisation. |
| **Regional Command** | Balanced. Regional readiness, multi-region responsibility. |
| **Logistics** | Supply throughput, deployment speed, overseas sustainment. |

All twelve postures are currently valid for every type: the type is about what the Command is *for*, not what it is allowed to do.

### The twelve postures

Defensive · Deterrence · Expeditionary · Counterinsurgency · Invasion Prep · Occupation · Sea Control · Sea Denial · Air Defense · Strategic Strike · Rapid Response · Training / Reserve

Each carries stated trade-offs on the panel: Expeditionary buys deployment speed and overseas sustainment at a higher supply cost; Rapid Response buys reaction speed at the cost of sustainment depth; Training/Reserve recovers readiness but is not deployable.

⚠️ **Command posture is not the same thing as unit posture.** A *unit* sits on Garrison / Standard / Forward-Deployed / High Alert (see [Units](/wiki/military-units)). A *Command* holds one of the twelve above. They are separate settings on separate objects.

## The nineteen strategic regions

Regions are the world's coverage grid: the map your Commands are responsible for. There are **19**, grouped into macro theatres:

| Macro theatre | Regions |
| --- | --- |
| **Polar** | Arctic |
| **Western Hemisphere** | North America · Central America & Caribbean · South America |
| **Atlantic Basin** | North Atlantic · South Atlantic |
| **European Theater** | Western Europe · Eastern Europe |
| **Southern Flank** | Mediterranean |
| **Greater Central Region** | North Africa · Middle East · Central Asia |
| **African Theater** | Sub-Saharan Africa |
| **Indo-Pacific** | South Asia · East Asia · Southeast Asia · Indian Ocean · Western Pacific |
| **Pacific Basin** | South Pacific |

Each region carries terrain, infrastructure, port and airbase capacity, strategic value, logistics difficulty, and a live threat reading. Regions are typed **land**, **naval**, or **mixed**: assigning a sea region to a Command with no naval structure is flagged as weak coverage.

**A region should be covered by exactly one Command of each type.** Commands of *different* types are welcome to share a region, and often should: a Regional command holding the ground while a Logistics command sustains it is the standard overseas pairing. The builder warns you only when a region is already assigned to another Command of the same type, and the coverage view flags two problems:

- **Uncovered**: no Command is responsible for it.
- **Overlapping**: two Commands *of the same type* both claim it, which is a genuine role conflict rather than useful redundancy.

**Region cap: 3 regions per Command.** The builder stops you at three, whatever the Command's type. A **Logistics** command is the structure meant to carry overseas sustainment, so the builder suggests pairing one with any non-Logistics Command whose regions span more than one macro theatre. Regions inside a single theatre share a supply tail: a Command that keeps to one theatre draws no such suggestion, however many of that theatre's regions it holds.

## Capacity and effectiveness

Every Command has a **force capacity** and an **effectiveness rating**.

**Capacity** is set when the Command is created and grows with the number of regions it covers. Each unit assigned to the Command consumes capacity in proportion to its weight: a Carrier Strike Group eats far more of a Command's capacity than a Frigate Squadron.

**Effectiveness** starts from the Command's base rating and is reduced by:

- **No commander: a flat 10% penalty.** A Command with nobody leading it is materially worse than one with even a weak general.
- **Over capacity**: a growing penalty the further past capacity you stack units. Overloading a Command is not free.

The panel gives you an itemised breakdown (base rating, then each penalty with its cost) so you can see exactly where a low rating comes from. Effectiveness never falls below a floor, and the interface colours it green above 82 and amber above 70.

The practical reading: **more Commands with reasonable loads beat one giant Command holding everything.** Capacity is per-Command, so splitting your army across a sensible structure avoids the over-capacity penalty entirely.

## Commanding Generals

Every Command has one **Commanding General**, chosen from its own commanders. If you do not pick one at creation, the first commander you selected takes the role by default.

The CG gets their own page at \`/country/<code>/general/commands\`, reachable by a **"Manage your command →"** link on their profile's Military tab. The link only appears for actual CGs.

On that page the CG can:

- **Post any of their Command's generals to a live conflict.** This is what deploys forces: the units assigned to a general follow them to the posting.
- **Un-post a general**, which pulls their entire force back to reserve.
- **Designate one general as Theater Commander** of a conflict.

What they **cannot** do is pick which units a general has. **That is derived**: a general's force is exactly the set of units the Secretary of Defense assigned to them, and the CG's page shows it read-only.

This is a deliberate split of powers. The Secretary of Defense decides *what forces exist and who holds them*. The Commanding General decides *where those forces go*.

Note that a CG edits only their own Command's postings. Every Command in the country writes into one shared assignment list, and the server merges each CG's submission back into it, so two CGs working simultaneously cannot wipe each other's postings.

## Theater Commanders

One general per conflict may be designated **Theater Commander**. Only one: the server refuses a second.

A TC gets two things:

**1. A front-wide command bonus.** A Theater Commander's own training carries, at a fraction of its strength, to *every* friendly unit at that front, not just the ones they personally lead. The fraction is deliberate: a single outstanding TC can never substitute for putting good generals on the units themselves. **Being in charge is worth less than being present.**

**2. Exclusive authority over offensives at that front.** That covers declaring and withdrawing offensives, and the front's **standing order** to join allied offensives automatically (see [Fighting a Battle](/wiki/fighting-a-battle)). The standing order is national policy rather than the commander's own setting, so it survives a change of Theater Commander the way the deployment does.

That second point is the one that catches people out.

> ⚠️ **Designating a Theater Commander locks the Secretary of Defense out of that conflict.** Until a TC exists, the defence seat holder may declare and withdraw offensives there. The moment one is named, only the TC can: the Secretary has delegated the front and cannot act over their head. Admins retain an override; nobody else does.

If a TC is dismissed, the front is **vacated** rather than orphaned: nobody is auto-promoted, and authority falls back to the defence seat holder. The Secretary has quietly taken the job back and should appoint a successor.

A TC also **earns XP for battles at their front even when they personally led no units in them**, at half what a general leading one average formation there would have earned. See [Generals](/wiki/generals).

## Live region threat

Region threat is not a static map. It is computed live, from your own country's point of view, and two players looking at the same region can legitimately see different numbers.

Threat rises from:

- **Pending offensives** at conflicts in that region.
- **Recent battles**, decaying over roughly 24 turns. Engagements where nobody made contact count for much less.
- **Massed forces** at a conflict there, higher still when both blocs have committed.

All of it is weighted by **how involved you are**. A conflict where *you* are the target reads far hotter than one between two other countries, which in turn reads hotter than one among your own allies. Proximity matters too: threat is amplified in your home region and its neighbours, and a share of it spills across borders into adjacent regions.

Bands: **Low · Medium · Rising · High · Severe.**

**Any region with a live conflict reads at least Medium**, even when the weighted heat would be lower: an active war is never reported as calm.

Regions with no live conflict and no recent fighting read **Low**. The world genuinely starts quiet; threat appears because something is happening, not because a designer decided that region is dangerous.

## Assigning units

Units are attached to **generals**, not directly to Commands, and they are attached by the **Secretary of Defense** from the office → **Military** → roster. Each unit card carries an **"Assign to …"** dropdown listing your commissioned generals.

A unit shows either **"Assigned · <general>"** or **"General Staff · unassigned"**. General Staff means no general, which means reserve, which means it cannot fight.

The rule that follows from this: **a unit is at whatever front its general is posted to.** Assign it to a general who is posted to the Manchurian Front and it is at the Manchurian Front. Un-post that general and it comes home. There is no separate deploy step, and no way to leave a unit at a front its general has left.

## Putting it together

A working structure looks roughly like this:

1. **Commission several generals.** They start accruing tenure points immediately.
2. **Build two or three Commands** with clear region responsibilities and no two Commands of the same type over one region: say a Homeland Defense command over your own region, a Regional command over where you expect to fight, and a Logistics command if you intend to fight overseas. Those last two will often cover the same region, which is intended: one holds the ground, the other sustains it.
3. **Appoint a Commanding General to each**, ideally one whose training fits the Command's job.
4. **Assign units to generals**, spreading the load so no Command sits over capacity.
5. **When war comes**, the relevant CG posts their generals to the conflict and names a Theater Commander.
6. **The Theater Commander runs the fighting** from the war room or the conflict page.

At that point the Secretary of Defense is doing what a defence minister should (raising forces and setting doctrine) while officers fight the war.

## Practical guidance

**Always give a Command a commander.** The flat 10% penalty for an empty Command is the cheapest mistake on this page to avoid.

**Do not overload one Command.** Over-capacity penalties scale. Two Commands at capacity beat one at double.

**Cover your own home region first.** An uncovered home region is the gap that will hurt.

**Do not name a Theater Commander until you mean it.** You are handing away your own ability to declare offensives there. Name one when you have a general who deserves the front and a player who will actually log in and run it.

**Pick TCs for training, not rank.** The front-wide bonus is drawn from the TC's *trained traits*. A Field Marshal with an untrained tree carries nothing to the front; a Major General with a deep, doctrine-boosted path carries real weight.

**Watch threat before you commit.** A region climbing from Low to Rising is telling you a conflict near you is heating up, usually before it becomes your problem.

## Next

- [Fighting a Battle](/wiki/fighting-a-battle): what the Theater Commander actually does.
- [Generals & the Officer Corps](/wiki/generals): who fills these roles.
- [National Doctrine](/wiki/national-doctrine): what makes them better at it.
`;
