export const manpowerConscriptionContent = `# Manpower & Conscription

Money buys equipment. **Manpower buys soldiers**, and it is usually the constraint that actually stops you.

Every nation holds a single pool of available men. Raising a unit draws its full establishment out of that pool. Every turn, the pool regenerates a little and your under-strength formations quietly refill from it. How fast all of that happens is decided by **legislation**.

Manage this from the defence seat's office → **Military** tab → **Operations**.

## The pool

Your pool has two numbers that matter:

- **Ceiling**: the most manpower you can ever bank. Derived from your **total population** and your conscription stance: **2% of population**, multiplied by the stance.
- **Regeneration**: what arrives each turn. **0.05% of population**, multiplied by the stance.

Both scale off population, so a large country genuinely fields more men. Both scale off the stance, so a country that mobilises its society hard gets more of them.

A fresh world does not start you at the ceiling. Each nation opens with **25% of its ceiling**, enough to field a real starting army, but not enough to skip the buildup. (A country starting at one turn's regeneration was the old behaviour, and it left East Germany unable to afford a single 12,000-man division.)

**Manpower is a hard block.** If you try to raise an Armored Division with 9,000 men in the pool, the order is refused with both numbers shown. You cannot borrow men, run a manpower deficit, or pay cash instead. Contrast this with the treasury, where overspending simply becomes debt.

Disbanding a unit returns its **surviving** personnel (not its establishment) to the pool.

## The conscription ladder

How hard your society is mobilised is a five-rung ladder. Each rung scales both the ceiling and the regeneration rate, and decides whether you may draft at all.

| Stance | Pool multiplier | Conscription allowed? |
| --- | --- | --- |
| **All-Volunteer Force** | ×0.6 | No |
| **Limited Service** | ×0.8 | No |
| **Selective Service** | ×1.0 | Yes |
| **National Service** | ×1.4 | Yes |
| **Universal Conscription** | ×2.0 | Yes |

The spread is enormous. A nation on Universal Conscription banks and regenerates **more than three times** what the same nation on an All-Volunteer Force would. This is the single biggest lever on how much army a country can sustain.

## The stance is a law, not a setting

You do not pick your stance from a dropdown. **It is the enacted level of your country's reserve-forces legislation**: the five levels of that law *are* the five rungs above.

| Country | The law | Level 0 → 4 |
| --- | --- | --- |
| **United States** | Reserve Forces Act | No Reserve System → Organized Reserves → **Ready Reserve System** → Deep Reserve Structure → Nation in Arms |
| **United Kingdom** | Territorial and Reserve Forces Act | No Reserve System → Territorial Army → **Ready Reserve System** → Deep Reserve Structure → Nation in Arms |
| **Russia / USSR** | Reserves and Voluntary Defense Act | No Reserve System → Reserve Registers → **Voluntary Defense Society** → Deep Reserve Structure → Nation in Arms |
| **East Germany** | Society for Sport and Technology Act | No Reserve System → Reserve Registers → **Sport and Technology Society** → Deep Reserve Structure → Nation in Arms |

**All four start at level 2** (the bolded rung), which is **Selective Service**, ×1.0 with conscription permitted. Nobody begins with a manpower advantage over anyone else; the differences appear only once someone legislates.

Raising the law to level 3 gets you ×1.4 and level 4 gets you ×2.0. Dropping to level 1 or 0 costs you conscription entirely.

So changing your manpower capacity means **passing a bill**. If you want to fight a long war, the reserve law is something to raise *before* you declare, not after you are already bleeding.

The bill-proposal modal shows the consequence directly on each level: you will see \` · manpower ×2\` or \` · manpower ×0.6, no conscription\` beside the option, so you can see what a level does to replacements before you file it.

**Simulated nations have no such law**, so they cannot legislate their way up or down. They fall back to a default table, which puts them on **Limited Service**, ×0.8 and no conscription. A playable country that raises its reserve law therefore pulls decisively ahead of every AI-run nation in sustainable army size.

## Replacement mode

Separately from the stance, you choose **how** under-strength units get topped up. Three modes:

| Mode | Refills per turn | Replacement quality |
| --- | --- | --- |
| **Off** | Nothing | None |
| **Trained** | Up to **10%** of establishment | Experienced: arrive with real training behind them |
| **Conscript** | Up to **25%** of establishment | Green: arrive with nothing |

Conscript rebuilds **two and a half times faster** and is available only if your stance permits conscription. If you select Conscript and your reserve law forbids it, the panel refuses you and names the stance that blocked it. The turn engine enforces the same rule independently, so there is no way to slip past it.

## XP dilution: the real cost of conscripts

This is the mechanic that makes veteran formations precious.

When replacements join a unit, **their inexperience is blended into the unit's own experience by headcount**. Not averaged with the old value as a formality: genuinely diluted in proportion to how much of the unit is now new bodies.

**Veterancy levels can drop.** An Elite division rebuilt from 40% strength with raw conscripts can come out the other side several grades lower. You keep the formation, its name, its general, and its position, but lose much of what made it good.

The consequences:

- **Rebuilding an elite unit with conscripts genuinely degrades it.** That is intended.
- **Trained replacements preserve quality**, at the price of rebuilding two and a half times slower.
- **Losses on veteran units are far more expensive than losses on green ones**, because the green unit has nothing to dilute.
- **A unit at high strength dilutes far less than one at low strength**, since fewer of its people are new. Topping a formation up early and often costs less experience than letting it be ground down and then rebuilding it in one go.

The strategic reading: **keep your good formations near full strength.** Pull a veteran unit before it is gutted, top it up with trained men, and send it back. A commander who fights every formation to exhaustion ends the war with a large, mediocre army.

## When replacement happens

Reinforcement runs on the turn tick, and its **position in the order matters**:

1. Force effects: upkeep, readiness drift
2. **Battles resolve**: units take casualties
3. Generals accrue tenure points
4. **Reinforcement**: the pool regenerates, then units top up

So a turn reads **fight → count the losses → rebuild**. A formation mauled in step 2 begins recovering in step 4, on the same tick, **in place**: it does not leave the front, does not lose its general, and does not need to be pulled back.

Two details:

- **Reinforcement runs for every country**, including simulated nations with no defence seat. Everyone sustains their forces; you are not fighting a static enemy.
- **The pool is spent in roster order and can run out mid-pass.** If your pool cannot cover everything, some units top up and the rest wait for next turn. A large damaged army recovers more slowly per formation than a small one.

## Reading the panel

The Operations tab shows you:

- **Pool**: men available now
- **Per turn**: your current regeneration
- **Ceiling**: the cap
- **Stance**: which rung your reserve law has you on
- **Mode**: Off / Trained / Conscript, with Conscript disabled and explained if your law forbids it

The regeneration and ceiling shown are computed with the **same formulas the turn engine uses**, so the panel cannot disagree with what actually happens.

## Practical guidance

**Manpower, not money, decides your army's size.** Work out your ceiling before you plan a force. A country that cannot bank 200,000 men cannot field a 200,000-man army no matter how rich it is.

**Raise the reserve law before the war.** It is a bill; bills take time; a war does not wait.

**Small elite formations are manpower-efficient.** A Special Forces Group costs 1,400 men. An Infantry Division costs 12,000. If your pool is the binding constraint, the ratio matters enormously.

**Peacetime is for banking.** With no war on, regeneration accumulates toward the ceiling and gives you a mobilisation base. A nation that fights continuously never builds one.

**Switch to Trained once the emergency passes.** Conscript mode is for plugging a hole fast. Leaving it on permanently converts your whole army to green troops over time.

**Watch the ceiling, not just the pool.** At the ceiling, regeneration is wasted: every turn you sit full is manpower you never receive. That is the moment to raise units or to lower the stance and save the upkeep.

## Next

- [Units, Recruitment & Procurement](/wiki/military-units): what to spend the manpower on.
- [Occupation, Territory & Victory](/wiki/occupation-and-victory): why long wars grind.
- [Fighting a Battle](/wiki/fighting-a-battle): where the casualties come from.
`;
