export const generalsGuideContent = `# Generals & the Officer Corps

A general is not an NPC. **A general is a player character** (one of your own, or one of your countrymen's) wearing a second hat.

Every character has two profile tabs: **Political**, the career you already know, and **Military**, which holds their general. The Military tab is empty until somebody commissions them. After that, it is a full progression system running in parallel with their political life: rank, experience, skill points, and a trait tree of 115 nodes.

This matters more than it sounds. **Generals are the only thing that makes your army better than the sum of its units.** An unled army fights; a well-trained general's army fights considerably harder.

## Getting commissioned

**You cannot commission yourself.** The **defence seat holder** appoints generals, from their office → **Commands** tab → *General Corps*. An acting secretary cannot: the general corps outlasts a caretaker appointment, so commissioning and dismissal wait for a confirmed holder.

They pick a character from their country and commission them. That character's Military tab immediately gains a general at:

- **Level 1: Brigadier**
- **0 XP**
- **4 starting skill points**
- **No traits trained**
- **No specialisation**

From that moment, **only the owning player can train them.** The Secretary of Defense decides *who* is a general; the player decides *what kind* of general they become. Nobody can spend somebody else's points.

## Rank and experience

Five ranks, earned by cumulative XP:

| Level | Rank | Cumulative XP |
| --- | --- | --- |
| 1 | Brigadier | 0 |
| 2 | Major General | 100 |
| 3 | Lt. General | 250 |
| 4 | General | 460 |
| 5 | Field Marshal | 740 |

Promotion is **automatic**: hit the threshold and it happens on the turn the XP lands. XP is cumulative and never spent, so your progress within a rank is the distance between two thresholds.

The corps roster and your own profile both show this as \`Lt. General · 84/210 XP to General\`.

### Earning XP

XP comes from **fighting**. A general earns:

- A **flat participation bonus** for every battle: **45 XP** for a win, **20 XP** for a loss.
- Plus a **per-unit share** for each formation they personally led in the engagement, scaled by how that formation did.

Notice that losing still pays. A general who fights and loses develops; one who never deploys does not.

The flat bonus is deliberately large relative to the per-unit share. For a country fielding one or two formations, it is most of the award, which means **small armies level their generals nearly as fast as superpowers do**, rather than being permanently outpaced.

### Theater Commanders earn too

A general who is **Theater Commander** of a front earns XP for battles fought there **even if they personally led no units in them**, at **half** what a general leading one average formation at that front would have earned.

Directing a war used to pay nothing at all, so a player could run three successful offensives as TC and see their general gain no experience whatsoever. It now pays, at half rate: commanding is worth less than commanding *and* fighting.

The measure is deliberately "one average formation," not the front's total. Otherwise a superpower's TC would level many times faster than a small nation's for identical work.

## Skill points

Points are the currency you spend on traits. **Every trait node costs exactly 1 point**, so points and nodes are the same thing and the whole budget is legible.

There are four sources:

| Source | Points | How |
| --- | --- | --- |
| **Commission** | 4 | Granted on appointment |
| **Promotions** | 16 | 4 points per promotion, paid exactly 4 times (levels 2 to 5) |
| **Tenure** | up to 20 | 1 point per **24 turns** of service, lifetime cap 20 |
| **Post-Field-Marshal** | up to 15 | 1 point per **200 XP** past the rank-5 threshold, lifetime cap 15 |

**Maximum lifetime total: 55 points**, against a tree of **115 nodes**.

You will never train even half the tree. **A general specialises because they cannot afford not to.** That is the central design of the system: choose a discipline and commit.

### Tenure: the peacetime track

Tenure exists because battles used to be the only source of points, which meant an officer in a nation at peace never developed at all.

- **1 point per 24 turns** (one real day) of service.
- **Capped at 20 lifetime**, reached after 480 turns, about twenty real days.
- Accrues **whether or not you fight**, and whether or not you are posted anywhere.

It is deliberately smaller than what campaigning pays (16 promotion + 15 post-FM = 31). Tenure keeps a peacetime officer from freezing; it is not meant to compete with fighting.

Tenure pays **every whole interval elapsed**, so a stalled world does not swallow the points it owed you, and it cannot pay twice for the same time. A newly commissioned general starts their clock at commissioning rather than being back-paid for a career they had not served.

### The post-Field-Marshal track

Once at Field Marshal, promotions stop and there is nothing left to earn from campaigning. So every **200 cumulative XP past the rank-5 threshold** grants one more point, up to **15 lifetime**.

The cap exists on purpose. Uncapped, a late-game commander eventually holds every node in the tree, and a game where one general has all skills because he is commanding everything is exactly what this is designed to prevent.

## The trait tree

115 nodes across **6 categories**:

| Category | Paths |
| --- | --- |
| **Command Style** | Aggressive Commander · Cautious Commander · Flexible Commander · Disciplinarian |
| **Battlefield Specialty** | Armor · Infantry · Artillery · Defensive |
| **Operational Specialty** | Maneuver · Attrition · Expeditionary · Occupation |
| **Logistics & Sustainment** | Supply-Conscious · Maintenance · Long Campaign Planner |
| **Joint Warfare** | Air-Land Integrator · Naval-Land Integrator · Marine/Expeditionary · Intelligence-Led |
| **Political & Staff Role** | Political Survivor · Staff Organizer · Trainer · Public Hero |

Each **path is a strict chain**: you must train a node before you can train the one after it. There is no skipping to a capstone.

Each node shows one of four statuses:

- **Learned:** trained.
- **Available:** the previous node in its path is trained, the era allows it, and you can afford it.
- **Locked:** an earlier node in the path is missing. The interface names *which* one.
- **Future:** the node's decade has not arrived yet in the game's calendar.

### Era gating

Nodes carry a decade, from the 1900s to the 2040s, and are gated against **the live game year**. In a 1953 world, *Shock Commander* (1950s) is trainable while *Adaptive Commander* (2000s) is not, no matter how many points you have banked.

This shapes long campaigns: banking points early lets you take newly unlocked capstones the moment their decade arrives.

### Conflicts and doctrine boosts

Some nodes are marked **"Conflicts with …"**: *Shock Commander* against *Methodical Commander*, for instance, since a general cannot credibly be both the maximum-aggression and the maximum-caution commander.

This is currently **advisory, not enforced**. Nothing stops you training both ends of a contradiction; the tree simply tells you that you are doing it. Treat it as roleplay and design guidance rather than a hard rule, and remember that with 55 points against 115 nodes, spending them on two traits that pull against each other is its own punishment.

Some nodes are **boosted** by your nation's adopted doctrine. A trait whose matching national doctrine has been adopted is marked with a star in the tree, and the profile has a **Doctrine Fit** view listing which of your trained traits are currently amplified and which are not. Training with your nation's doctrine in mind is materially better than training against it.

## Specialisation is derived, never chosen

You do not pick a class at commissioning. **Your discipline is a label for what you actually learned**, recomputed every time it is displayed:

| Discipline | |
| --- | --- |
| **Armor Officer** | **Shock & Maneuver** |
| **Defensive Tactician** | **Logistician** |
| **Fleet Commander** | |

A general who has trained nothing shows **"No specialisation"**, not a discipline they never earned. As they train, their label drifts: enough logistics nodes and an Armor Officer genuinely becomes a Logistician. Nothing is stored, so the label can never go stale.

Alongside it, **command fit** (40 to 98) rates how suitable they are to lead a Command, derived from their rank plus how many nodes they have trained.

## Dismissal

The defence seat holder can dismiss a general. When they do, the whole chain unwinds at once:

- They leave **every Command roster** they were on.
- Any Command they **led** loses its lead.
- All their **conflict postings** are dropped.
- Every **unit assigned to them** falls back to General Staff and returns to reserve.

**Nobody is promoted to fill the gap.** Dismissing a Theater Commander vacates that front: authority falls back to the defence seat holder, so it is never orphaned, but the Secretary has quietly taken the job back and needs to appoint a successor.

**The record survives.** Level, XP and every trained trait are retained. A dismissed general shows as **"Former"** on the corps roster, and re-appointing them restores everything intact. Dismissal is a change of employment, not an execution.

**Moving abroad runs the same cascade.** A general who relocates to another country comes off every Command roster, vacates any Command they led, loses their conflict postings, and hands their divisions back to the old country's General Staff, exactly as a dismissal would. See [Relocation](/wiki/relocation).

## Where to click

| Task | Where |
| --- | --- |
| Commission or dismiss a general | Defence office → **Commands** → General Corps |
| See your country's whole corps | Same panel |
| Train your own general's traits | **Your profile → Military tab** |
| See another character's general | **Their profile → Military tab** (read-only) |
| Post generals to conflicts | \`/country/<code>/general/commands\` (Commanding Generals only) |

If you are a Commanding General, a **"Manage your command →"** link appears on your own profile's Military tab. It only shows for actual CGs, so it never dead-ends.

## Practical guidance

**Commission early and broadly.** Tenure points accrue from the day of commissioning and cap at 20. A general commissioned in peacetime arrives at the war already developed; one commissioned the week war breaks out starts from four points.

**Pick a lane in the first few points.** With 55 lifetime points against 115 nodes, spreading thin produces a general who is mediocre at everything. Chains are strict, so a deep path costs you the early nodes anyway, and committing is the whole point.

**Train toward your nation's doctrine.** Boosted traits are strictly better than unboosted ones for the same point. Look at what your Secretary of Defense has adopted before spending.

**Fight. Even badly.** 20 XP for a loss beats 0 XP for staying home, and casualties can be rebuilt. A general who never deploys never advances past what tenure alone gives them.

**A Field Marshal is not finished.** The post-FM track pays 15 more points, but only through combat. A maxed general still has a reason to campaign.

**Don't sever a general from their units carelessly.** Units follow generals. Un-posting a general pulls their entire force back to reserve: sometimes exactly what you want, sometimes an accidental retreat.

## Next

- [Commands & Command Structure](/wiki/military-commands): the org chart your generals sit in.
- [National Doctrine](/wiki/national-doctrine): what boosts their traits.
- [Fighting a Battle](/wiki/fighting-a-battle): how to put them to work.
`;
