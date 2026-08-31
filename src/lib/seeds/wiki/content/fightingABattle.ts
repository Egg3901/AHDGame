export const fightingABattleContent = `# Fighting a Battle

A war exists. Now you have to actually fight it.

This page is the operational loop: get forces to the front, look at the odds, declare an offensive, survive the turn, read what happened. Everything here happens either in the **war room** (\`/world/conflicts/combat\`) or on the **conflict record** (\`/world/conflicts/<number>\`). Both work, and both use the same underlying authority.

## Step 1: Get forces to the front

There is no "deploy" button. Deployment is two separate acts by two different people.

**The Secretary of Defense assigns units to a general.**
Office → **Military** → roster. Each unit card has an *Assign to …* dropdown listing your commissioned generals. A unit reads either **"Assigned · <name>"** or **"General Staff · unassigned"**.

**The Commanding General posts that general to the conflict.**
\`/country/<code>/general/commands\`. Pick the conflict from the dropdown beside each of the Command's generals.

The moment the posting saves, **every unit assigned to that general is at that front**. Un-post the general and the whole force returns to reserve.

Two consequences worth internalising:

- **A unit with no general can never fight.** General Staff means reserve, permanently, until somebody assigns it.
- **Un-posting a general is a full withdrawal.** It is the only way to pull forces out, and it pulls *all* of them.

⚠️ **Newly built units cannot fight.** A unit is excluded from battle entirely until its build time elapses: 6 turns for most types, 10 for a Carrier Strike Group. It will not appear in a forecast and will not fight if you declare. Check before you commit.

**Postures floor up.** A unit on Garrison automatically rises to Standard when it reaches a conflict. Garrison is a homeland-only posture.

## Step 2: Read the war room

The war room shows you, for your chosen target:

| Readout | What it tells you |
| --- | --- |
| **Projected strength** | Your own side's committed weight at this front. |
| **Odds ("You attack")** | Your chance of winning if *you* launch the offensive. |
| **Odds ("They attack")** | *Their* chance of winning if they launch it instead. |
| **Supply** | SUPPLIED · STRAINED · SHORTAGE · CUT OFF, with the level in brackets (what the front can haul as a share of what your formations there draw) |
| **Enemy** | A coarse band, never a number. |
| **Forces** | How many nations are pooled on each side. |

### The two odds rows do not add to 100

This confuses everyone the first time.

**Each row is the chance of whoever is attacking in that row.** "You attack" is your chance when you move; "They attack" is *their* chance when they move. Neither row is the other's leftover, so subtracting one from 100 tells you nothing.

**Attacking is harder than defending.** The defender holds terrain, and the attacker is the one crossing it. So the same pair of armies produces different odds depending on who moves.

With comparable forces, **both players can simultaneously see themselves under 50%.** That is not a bug and the rows are not derived from each other: each is a real projection of a different battle. The rows are labelled "You attack" and "They attack" precisely so this reads correctly.

The strategic conclusion: **there is a band of force ratios where nobody should attack.** If both sides read the board honestly, a front can stall, and stalling is a legitimate outcome, not a failure state.

### The enemy band

You never see the enemy's order of battle. You see one of:

- **No forces detected**: the front is undefended
- **Token resistance**
- **Weaker force**
- **Evenly matched**
- **Stronger force**
- **Overwhelming force**

The band is deterministic, so looking twice never gives you two different answers, but it is deliberately coarse. You are being told roughly what you face, not handed a spreadsheet.

### The forecast is the real thing

The projection you see is computed by **the same code that resolves the battle**, from the same units, the same supply, the same terrain and the same air and naval support over the front. It is not a separate estimate that might disagree.

**But it is odds, not a promise.** The battle is fought at the projected chance plus the fortune of the day, so a 70 percent attack fails three times in ten and a 20 percent attack sometimes carries the field. Losing a fight you were favoured to win is the number working, not the number being wrong. Judge a plan over a campaign, not over one tick.

What the projection cannot know is what changes before the tick. Your opponent has a full turn to reinforce, and the odds you acted on can be stale by the time the battle happens.

## Step 3: Declare the offensive

Press **Declare offensive**, pick the enemy nation.

Every check must pass:

1. **The conflict must be live**: not resolved, and not already won outright. A war whose front has run to the end of the track takes no more offensives while the victor names terms.
2. **You must have authority here**: the Theater Commander if one is designated, otherwise the defence seat holder. Admins always.
3. **Your nation must have a side** in this conflict. You can be on it by roster, or by your bloc backing one of the sides.
4. **Your target must be an actual belligerent**: by roster only. You cannot drag a bystander in, even a bloc rival. *(Note the asymmetry: your own side may resolve through your bloc, your target's may not.)*
5. **Your target must not be on your own side.**
6. **You must have at least one unit at this front.** No forces, no offensive.
7. **You must not already have a pending offensive here.** One at a time.

Withdrawing a declaration before it resolves is free and instant.

### The standing order: join allied offensives

Defence has always been automatic: an ally with troops at a front defends it whether or not anyone gave an order. Attacking used to demand a fresh declaration from every ally on the same turn, so a joint push took two nations acting in the same hour.

The conflict page now offers a **standing order** per front: *join allied offensives here automatically*. With it on, your forces at that front fight in any offensive an ally declares there, without a separate order from you. Off is the default.

- It needs troops already posted to that front, exactly like automatic defence. A standing order never moves an army and never pulls you onto a side you are not on.
- It is national policy, set by whoever holds offensive authority at the front, and it survives a change of Theater Commander.
- An ally that joins this way appears in the war log under its own flag with its own casualties. Withdrawing your forces from the front is the way to stop supporting an offensive.
- The war room's odds already count allies who will join, whether by their own declaration or by standing order, and its "They attack" row counts every nation with troops on your side.

## Step 4: The defender's window

**An offensive declared this turn resolves on the next one.** That gap is the whole tactical game.

If you are the defender, you can spend it:

- **Reinforcing**: post another general with their force to the front.
- **Withdrawing**: un-post the general and take your army home. The attack then hits an empty front.
- **Reshuffling**: change who leads what, or name a Theater Commander for the front-wide bonus.

But there is a catch:

> ⚠️ **You are never told that an offensive has been declared against you.** Incoming declarations are hidden by design. You have to infer an attack from your enemy's build-up: forces massing, threat climbing in the region, a front that suddenly has an army on it.

Defending well is an act of reading the board, not of reacting to an alert. Watch region threat and the conflict record.

## Step 5: Resolution

On the tick, battles resolve in a fixed position in the turn: after force effects, before general tenure and reinforcement. So the order is **fight → count losses → rebuild**.

### Coalitions merge

Every ally who declared against the **same side at the same front**, plus every ally with a standing order to join there, is folded into **one offensive**. They fight together, appear on one report, and each nation's dead are recorded under its own flag.

The merge key is *the front and the attacking side*, **not the named target**. Two allies naming different enemies on the same side are running one attack, because the front and the defending coalition are identical.

**Defenders do not have to declare anything.** Every country with units at the front that resolves to the defending side is automatically in the battle. Deployment *is* the consent step: you sent troops, so you are fighting.

Countries that fight are **enrolled on the roster** they fought for, before the battle resolves. A country that keeps intervening on one side eventually becomes a formal belligerent.

### Unopposed offensives

If nobody is defending, the offensive **walks forward**: it advances territory at full rate rather than fizzling.

This is deliberate. Without it, a nation that simply never deploys anything would be permanently immune to invasion. Refusing to defend is not a defence.

### Retreat

A side whose cohesion collapses partway through can **break off** rather than fight the engagement out. When that happens:

- The battle ends early.
- The side that broke **loses**.
- But it takes **materially fewer casualties** than it would have fighting to the end.
- And it **gains less ground for the winner** than a clean break would have.

**Units hold position and keep their general.** A retreat is not a rout off the map: the formation stays at the front, still under command, and starts rebuilding on the same turn.

### Fizzles

A declaration can resolve into nothing:

- The conflict was **resolved** before the tick.
- The matchup **could not be placed** on opposing sides.
- Nobody was home **and** no ground could move.

A fizzled declaration produces a "no contact" report and costs you the turn.

## Step 6: Read the report

Every engagement writes a permanent battle report. Verdicts, best to worst from the attacker's view:

**Decisive Victory → Victory → Pyrrhic Victory → Costly Defeat → Rout**

The report carries the verdict, both sides' losses, who fought on each side, whether either side withdrew, and the territorial position **before and after**, so you can see exactly what the win bought.

What you see depends on your tier:

- **Public**: verdict, both loss totals, territory. That much is always public.
- **Command**: plus your own order of battle and a coarse enemy band.
- **Archive** (480 turns after the war resolves): everything, both sides, per engagement, including who lost what.

## What actually decides a battle

The resolution model is deliberately not published in detail: knowing the exact equation would let you solve fights rather than fight them. But nothing about the *inputs* is secret, and they are these:

**Force quality**

- **Strength.** A unit at 40% headcount fights like a much smaller unit. This is linear and it is the biggest single lever.
- **Veterancy.** Elite formations are substantially better than green ones. Veterancy is a five-grade table, not a compounding multiplier.
- **Technology tier.** Real but modest, smaller than veterancy, and it costs upkeep forever.
- **Equipment.** A small, steady bonus.
- **Readiness.** A tired army fights worse, and a battle costs a worn formation far more readiness than a fresh one. Readiness climbs back toward its posture baseline at eight points a turn, so pressing every turn keeps a force exhausted while a few turns of rest bring it back. The pace you fight at is a real choice.
- **Frontage.** A front has finite width. Only so much force can be in contact at once; the rest sits in depth, where it neither fights nor bleeds this turn. Frontline and flank units take their places in the line first, then support, then anything held back. Terrain widens or narrows the line: open plain and desert hold the most, mountains and jungle the least.
- **Naval reach.** A carrier's air wing genuinely strikes inland and keeps most of its effect on a coastal front. Escorts, submarines and amphibious groups contribute very little to a division fighting inland of them. Whether a front touches the sea is worked out from the host country.
- **Posture.** Higher postures fight better and cost more.

**Command**

- **Generals' trained traits.** This is what makes generals matter: *trained traits*, not rank. A Field Marshal who has never spent a point is the identity modifier. A Major General with a deep, doctrine-boosted path is not.
- **The Theater Commander's bonus**, applied front-wide at a fraction of what their traits give the units they personally lead.
- **National doctrine**, applying to everything you field.

**Position**

- **Terrain**, from the host country's region. It favours the defender.
- **Supply**, which degrades as a front moves away from where it started (see [Occupation](/wiki/occupation-and-victory)).
- **Unit roles**: Frontline, Support Line, Reserve, Flank/Screen, Rear Area, Deep Strike. Frontline units do the most fighting and take by far the most casualties; rear-area units take almost none but contribute little directly. Roles are set on the unit dossier in the war room.

**Scale**

- Each country carries a scale factor reflecting the weight of its military establishment.

## Practical guidance

**Concentrate.** One front with a real army beats three fronts with fragments. Capacity, supply and the odds all reward concentration.

**Do not attack at even odds.** Terrain means "evenly matched" favours whoever is standing still. Attack when the band reads *Weaker* or *Token*, or when you can afford a grinding win.

**Let them come to you.** If your "They attack" row is much better than your "You attack" row, the correct play is to hold and make the enemy cross. Sometimes the winning move is not moving.

**Watch supply.** SHORTAGE or CUT OFF is a warning that your position is degrading, not just flavour. A front pushed too far outruns its logistics.

**Know what feeds supply.** Supply is what the front can haul against what your formations there draw. Hauling comes from the ground's infrastructure, your logistics doctrine and generals, a Logistics command covering the region (worth more the larger the force it covers), depth formations feeding the line, and fighting on your own soil. Drawing comes from every formation you have posted there: ground and marine formations in the line draw in full, formations held in depth draw less, and air, naval and rocket formations draw a quarter. Air superiority and sea control do not feed your own supply; they only let you cut the enemy's. If the readout says CUT OFF while you own the sky, you have too much posted at one front.

**Rotate veterans out before they are gutted.** Losses on an elite formation are far more expensive than on a green one, because rebuilding dilutes experience in proportion to how many replacements arrive. Top up early.

**Set roles deliberately.** Putting your best formations on Rear Area protects them and wastes them. Putting fragile specialists on Frontline gets them killed.

**Withdrawal is a real option.** Un-posting a general before an attack lands costs you ground but saves the army. An army that exists can retake ground; one that has been destroyed cannot.

**Name a Theater Commander with trained traits.** The front-wide bonus comes from their *tree*, not their rank.

## Next

- [Occupation, Territory & Victory](/wiki/occupation-and-victory): what winning battles actually buys.
- [Peace, Indemnities & Truces](/wiki/peace-and-truces): how it ends.
- [A War, Start to Finish](/wiki/a-war-start-to-finish): all of this in sequence.
`;
