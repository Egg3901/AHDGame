export const nationalDoctrineContent = `# National Doctrine

Doctrine is your country's **way of fighting**: the accumulated institutional choices that make one army an armoured breakthrough force and another a defensive attritional one.

Mechanically it is a national tech tree, adopted once and shared by everything: every unit, every general, every front. Unlike a general's traits, which belong to one character, **doctrine belongs to the nation** and applies to all of it at once.

Adopt doctrine from the defence seat's office → **Doctrine** tab.

## The budget is brutally small

Read this before anything else on the page.

- Your nation starts with **12 doctrine points**.
- The tree has **128 nodes**, costing **1 to 5 points each**.
- **You gain 1 additional doctrine point at the start of each game year.** Fighting, research, and legislation do not grant more.

Adopting the whole tree would cost **369 points**. A long campaign adds a handful of extra points, enough to specialise as later decades unlock, not enough to clear the tree.

So a nation still adopts only a small number of additional doctrines on top of what it starts with. This is not a tree you clear: it is a small number of permanent, irreversible commitments about the kind of military power your country intends to be.

**There is no refund and no respec.** Adopting is one-way. Spend a point badly and it is gone.

## What you start with

Every nation begins with twelve doctrines already adopted, free: the baseline every modern military shares:

- **Maneuver Warfare**, the full early chain
- **Firepower Warfare**, the opening nodes
- **Defensive Warfare** and **Infantry-Centric Warfare**, the foundations
- **Joint Operations**
- **Industrial Mobilization** and **Strategic Logistics**

You are not starting from nothing. You are starting from a competent conventional army and deciding what to specialise it in.

## The tree

**8 categories**, each with several paths, each path a chain of nodes across the decades:

| Category | Paths |
| --- | --- |
| **Land Warfare** | Maneuver · Firepower · Defensive · Infantry-Centric |
| **Naval Warfare** | Blue-Water Navy · Carrier Doctrine · Submarine & Sea Denial · Coastal Defense |
| **Air Warfare** | Air Superiority · Close Air Support · Strategic Bombing · Integrated Air Defense |
| **Expeditionary Warfare** | Amphibious Assault · Expeditionary · Island & Littoral · Marine Air-Ground Task Force |
| **Mobilization & Logistics** | Industrial Mobilization · Strategic Logistics · Reserve System · Maintenance & Readiness |
| **Strategic Warfare** | Deep Strike · Missile Warfare · Cyber & Electronic · Drone & ISR |
| **Irregular & Security** | Guerrilla · Counterinsurgency · Special Operations · Internal Security |
| **Command & Intelligence** | Joint Command · Reconnaissance & Intelligence · Communications · Mission Command |

Node costs rise with sophistication: 20 nodes cost 1 point, 27 cost 2, 39 cost 3, 32 cost 4, and 10 cost 5. Early foundational doctrines are cheap; late capstones are not. With a 12-point budget, **one 5-point capstone is over 40% of your national doctrine**.

## Era gating

Every node carries a **decade**, from the 1900s to the 2040s, and 15 named eras run alongside them:

Industrial War Foundations · Great War · Interwar Experimentation · Mechanization & Rearmament · Total War · Nuclear Age & Jet Warfare · Counterinsurgency & Missiles · Precision & Professionalization · Air-Land Battle & Networks · Post-Cold War Expeditionary · Counterterror & Network-Centric · Drone, Cyber & Hybrid · Transparent Battlefield · Autonomous & AI · Fully Integrated Multi-Domain

Your current era is derived from the **live game year**: the decade bucket you are actually in. A 1953 world sits in the Nuclear Age. Anything from a later decade shows as **Future** and cannot be adopted, however many points you hold.

This means a long-running world genuinely progresses. Doctrines that were unreachable in 1953 open up as the calendar advances into the 1960s, 70s and beyond. **Banking points against a decade you know is coming is a legitimate strategy**: and one of the few ways to spend a scarce budget well.

## Prerequisites

Two kinds, both enforced:

1. **In-path predecessor.** Paths are strict chains. To adopt the 1960s node in Carrier Doctrine you must already hold the 1940s one. The interface names the specific doctrine you are missing rather than saying "earlier doctrine required."
2. **Named cross-path requirements.** Some nodes require a doctrine from a different path entirely: the tree names it.

A node shows one of four statuses:

| Status | Meaning |
| --- | --- |
| **Adopted** | You have it. |
| **Available** | Prerequisites met, era reached, and you can afford it. |
| **Locked** | A prerequisite is missing. The panel names which. |
| **Future** | Its decade has not arrived. |

Chains mean **depth is expensive**. Reaching a 1980s capstone may require paying for three earlier nodes in the same path first. Budget the whole chain before you start walking it, not just the node you want.

## "Conflicts with"

Some doctrines display a **"Conflicts with …"** line, for example Guerrilla Doctrine against Conventional Professionalization, or Mission Command against Centralized Command.

**This is advisory, not enforced.** Nothing stops you adopting both. It is a statement about what the two doctrines mean, meant to guide a coherent national identity, and the real cost of ignoring it is that you spent scarce points pulling in two directions.

## What doctrine does

Adopted doctrine feeds into how your forces perform. It is genuinely national: it applies to every unit you field and every front you fight on, permanently, from the moment it is adopted.

Broadly, different branches of the tree push on different things:

- **Land, Naval, Air, Expeditionary**: how well your forces fight, with several nodes favouring a specific domain rather than the whole army.
- **Mobilization & Logistics**: sustainment and how well a force holds together over a long campaign.
- **Command & Intelligence**: joint operations and coordination across branches.
- **Strategic Warfare**: deep strike and reach.
- **Irregular & Security**: insurgency and counterinsurgency.

Each node states its own effect in plain terms on the panel. The **Active Effects** summary at the side of the Doctrine tab shows everything currently in force, so you can see your national profile at a glance.

## Doctrine boosts your generals

This is the connection most players miss.

Many **general trait nodes** are tied to a matching **national doctrine**. When your nation has adopted that doctrine, the trait is **boosted**: it appears starred in the general's trait tree, and it is meaningfully better than the same trait in a nation without the doctrine.

Every general's profile has a **Doctrine Fit** view listing which of their trained traits your nation currently amplifies, and which are running unsupported.

The strategic consequence: **doctrine and officer training should be planned together.** A nation that adopts deep-strike doctrine and then trains all its generals as defensive tacticians has wasted both. Your defence minister's starting points effectively decide which officer careers are worth pursuing, so the corps should know what has been adopted before spending their own points.

## Who adopts

Only the **defence seat holder**: Secretary of Defense, Defence Secretary, Minister of Defence, or equivalent. Not the head of government, not generals, not the legislature.

Because doctrine is permanent and the budget tiny, **this is one of the most consequential powers in the game and one of the easiest to squander.** A minister who dumps the starting twelve points in their first week has locked in their country's military identity for every successor.

The server re-validates every adoption independently: points, prerequisites, and era are all checked again server-side, so a crafted request cannot buy a doctrine you have not earned.

## Practical guidance

**Do not spend early just because you can.** There is no pressure to. Unspent points keep their value; badly spent ones never come back.

**Pick an identity, then buy toward it.** "We are a maritime power" or "we are a continental armoured force" should be decidable from your adopted list. A scattered set of twelve points produces a nation good at nothing.

**Count the whole chain first.** A capstone with three unowned predecessors is not a 4-point purchase; it is a 4-plus-everything-before-it purchase, which may be your entire budget.

**Coordinate with the corps.** Tell your generals what the nation has adopted so they train into it. Boosted traits are free capability; unboosted ones are half-wasted points on both sides.

**Watch the calendar in long games.** Decades unlock. If a doctrine you want opens in eleven game months, holding two points is often better than spending them now.

**Remember it is national and permanent.** A successor minister inherits your choices and cannot undo them. Doctrine outlives cabinets.

## Next

- [Generals & the Officer Corps](/wiki/generals): the traits doctrine boosts.
- [Commands & Command Structure](/wiki/military-commands): where doctrine shows up in the org chart.
- [Fighting a Battle](/wiki/fighting-a-battle): where it finally matters.
`;
