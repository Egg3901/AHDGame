export const declaringWarContent = `# Declaring War

You do not click a button and start a war. You **file a bill**, and your legislature decides.

This is the single most important thing to understand about war in A House Divided: a declaration is an act of the legislature, held to a higher bar than almost anything else in the game, and a president or prime minister who cannot carry two-thirds of their chamber cannot go to war at all.

## Who may file

Exactly two offices, with no precedence between them:

- **The head of government**: President, Prime Minister, Chancellor, General Secretary, whichever your country has. This is resolved from whichever office actually runs your government, so a US President and a UK Prime Minister both qualify by different routes.
- **The defence seat holder**: Secretary of Defense, Defence Secretary, Minister of Defence, and equivalents.

Nobody else. Not the foreign minister, not the legislature itself, not a general.

**Where to click:**

| If you are… | Go to |
| --- | --- |
| Head of government | Your executive shell → **Foreign Affairs** tab |
| Defence seat holder | Your cabinet office → **Commands** tab → *Declaration of war* |

Both surfaces post to the same place and behave identically.

## The cost of filing

Filing a declaration costs **10 action points**, exactly like any other bill. If the legislature **passes** it, the points are **refunded**. If the chambers throw it out, you have spent them.

That refund shapes the strategy: a declaration you are confident of is nearly free, while a speculative one you expect to lose is a real cost. Do not file to "test the water."

## The two-thirds bar

A declaration of war must carry a **two-thirds supermajority of votes cast** in every chamber it passes through. Abstentions are excluded: the bar is two-thirds of For plus Against.

**There is no exemption for anyone.** Ordinary nationalisation and privatisation bills give one-party states a simple-majority carve-out, on the reasoning that a single-party legislature rubber-stamps economic policy anyway. That carve-out is deliberately **not** extended to war. A one-party state's rubber-stamp legislature must still deliver two-thirds.

The bill sits open for **24 turns** (one real day). A declaration is not a rush job, and the delay is a real strategic window in which your target can see the debate happening and prepare.

Because it is an ordinary bill in every other respect, it appears on the legislature floor, it can be whipped, it can be argued against, and it can be killed. Opposition to a war is a legitimate and effective play.

## Choosing a war goal

Every declaration names what the war is *for*. The goal is recorded on the conflict permanently and is what peace terms are negotiated against.

| Goal | What it means | Available? |
| --- | --- | --- |
| **Regime Change** | Force a change of government in the defending country. | Yes |
| **Punitive** | Extract concessions by force, then withdraw. | Yes |
| **Liberation** | Free territory or an ally held by the defender. | Yes |
| **Conquest** | Take and hold enemy territory. | **Not yet** |

**Conquest is reserved and cannot be selected.** Nothing in the game transfers territory between countries yet, so a war fought for conquest could not actually be won on its own terms. The option is visible but disabled, and the server refuses it too: you cannot slip it past the interface by hand-crafting a request. It will be switched on when annexation exists.

## Every check your declaration must clear

The declaration is refused, before it costs you anything, if any of these fail:

1. **The target exists and is open to players.** Sub-national entities like Scotland and Wales, and countries an admin has not switched on, cannot be declared on, since there would be nobody able to play the other side.
2. **It is not yourself.**
3. **The war goal is one of the selectable three.**
4. **You are not already at war with them.** This includes the indirect case: if you and your target are already facing each other on opposite sides of a war *someone else* started, you are at war and cannot open a second one.
5. **Your declaration cooldown has lapsed.** See below.
6. **No truce is in force between you.** See below.
7. **No declaration against that same country is already before the chambers.** One at a time.

## The 120-turn cooldown

A country may file a declaration of war only once every **120 turns** (about five real days).

The clock runs from your **last proposal, not your last passage.** A declaration your chambers threw out still spent your cooldown. This is deliberate: if a rejected declaration could be re-filed immediately, the vote would mean nothing, and an executive could simply keep tabling it until attendance favoured them.

The panel tells you how many turns remain rather than making you discover it by refusal.

## The 240-turn truce

When **any** war between two countries ends, whether negotiated, conceded, or won outright, a **240-turn truce** (about ten real days) is recorded between them. Neither may declare on the other until it lapses.

This is not a negotiated term. Neither side can trade it away in a peace deal.

It exists to close an obvious exploit: without it, a country you conquered on turn 100 could be re-declared on the moment your 120-turn cooldown lapsed, at precisely the point it is least able to resist. The truce outlasts the cooldown by design.

Truces are recorded for **every cross-side pair**, not just the two principals. If four countries fought, all cross-side combinations are truced, so an ally who did the actual fighting is not left free to re-declare while the principal waits.

Your defence office's declaration panel lists your live truces and greys out the countries you cannot target, so you see the bar in the picker rather than after committing.

## Treaty allies come in with the defender

Ratification is not the only way into a war. **NATO and the Warsaw Pact carry collective-defence charters, and the engine honours them.** The moment a declaration against a member is enacted, every other member of that alliance that holds a ballot is enrolled on the defender's side, automatically, with no vote and no bill. The alliance is named in the war's belligerent roll ("Warsaw Pact → DD"), and the countries pulled in are notified.

Three things follow from that:

- **It is defensive only.** The trigger is a declaration *against* a member, never "a member is at war". An ally dragged in to defend has declared on nobody, so its own alliances never fire in turn. Chains cannot happen.
- **A truce still holds.** A member truced with the declarer is not pulled in against it.
- **The ally is a full belligerent.** Its troops defend the front automatically if posted there, its approval carries the war, and it is judged on what it fields against what its co-belligerents field. It can also negotiate its own way out (see [Peace, Indemnities & Truces](/wiki/peace-and-truces)).

There is a second route in for a bloc: a member can table a resolution calling the whole organization into a conflict. That needs **unanimous consent** from every member entitled to vote, because it commits allies' soldiers, and it lands as a join-conflict bill in each member's legislature. See [International Organizations](/wiki/international-organizations).

Autonomous governments use these roads too. A country nobody plays can ratify a war-entry bill on its own, provided its public approval, readiness, treasury and alliance all support it, and it deploys real forces when it does.

## What happens the moment it passes

Ratification fires immediately on enactment. One of two things happens:

### There is no live war in the defender

A **new conflict** is created, hosted in the defending country:

- Named after the two belligerents.
- Side A is you; side B is the defender.
- Region, terrain and infrastructure are derived from the defender's home region.
- **Territorial control opens at the defender's own pole**: they hold 100% of their own soil. You are starting from nothing, which is exactly right for an invasion. (The one exception is a war the German Question attaches to, which is fought over both Germanies and opens on an even front.)
- It is assigned the next sequential conflict number and gets its own page.

### There is already a live war in the defender

You do **not** open a second war over the same ground. You are **enrolled on the side opposing the defender** in the existing conflict.

This keeps one war per besieged country and one pin per map location, and it matches how coalitions work. Note the subtlety: the side you join is the one *opposing the defender*, which is not automatically side B, since the defender may already be sitting on side A of a war somebody else started against them.

## Opening forces

A brand-new war does not begin with two empty fronts.

When a conflict is created, a **small, matched slice of both sides' uncommitted reserve** is deployed to it automatically. Both sides commit the same share, measured against whichever side's reserve pool is smaller, and the smallest formations are picked first so one oversized unit does not turn a token commitment into an all-in deployment.

Two things this deliberately does **not** do:

- **It never invents units.** If either side has no uncommitted reserve, nothing moves at all. A country with no army does not get handed one to make the opening look fair.
- **It does not take over.** Those units remain fully yours to manage, reassign, or withdraw on the very next turn.

The point is only to remove the degenerate opening where the first battle is decided by whichever player happened to log in first and deploy.

## Strategic notes

**The 24-turn debate is public.** Your target sees a declaration bill on your legislature floor before the war starts. Surprise attacks are not really available to you at the declaration level: surprise lives at the *offensive* level instead, once a war is already running.

**Filing is cheap, losing is not.** The 10 AP refund means a well-whipped declaration costs nothing. Count your votes first.

**Joining someone else's war by declaration has no cooldown advantage.** Enrolling in an existing conflict through your own declaration still consumes your 120-turn cooldown, because it still goes through a full declaration bill. Being pulled in by a treaty is different: no bill, no cooldown, and no choice.

**Declaring rallies the public, once.** A war declared from peace opens with a wave of support that turns into war exhaustion after about a year of fighting, and that exhaustion is carried across a peace and heals only slowly. A country that goes straight from one war into the next gets no fresh rally at all. See [Government Approval](/wiki/government-approval).

**Check the truce list before you plan a campaign.** Ten real days is a long time to discover you cannot attack the country your whole build-up was aimed at.

**A war you start is not a war you can end.** Peace is negotiated by the head of government or the **foreign** minister. If you are the defence secretary who filed the declaration, ending it is somebody else's signature.

## Next

- [Fighting a Battle](/wiki/fighting-a-battle): what to do once the war exists.
- [Peace, Indemnities & Truces](/wiki/peace-and-truces): how to get back out.
- [A War, Start to Finish](/wiki/a-war-start-to-finish): a full worked example.
`;
