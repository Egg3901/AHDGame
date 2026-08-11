export const peaceAndTrucesContent = `# Peace, indemnities & truces

Most wars do not end by conquest. Thirty to forty won battles is a very long campaign, and the side that is losing usually has a cheaper option: **buy its way out**.

Peace in A House Divided is a bilateral deal between **two countries**, not between two sides. You are ending *your own participation* in a war. Everybody else keeps fighting.

## Who negotiates

Peace is **not** the defence seat's job.

| Power | Who holds it |
| --- | --- |
| Declare war | Head of government **or** defence seat holder |
| Negotiate peace | Head of government **or** **foreign** seat holder |

Two offices, no precedence between them: either may act. This is a deliberate constitutional split: **the minister who takes you into a war is not the minister who takes you out of it.**

**Where to click:**

| If you are… | Go to |
| --- | --- |
| Head of government | Executive shell → **Foreign Affairs** tab |
| Foreign minister | Your cabinet office → **Overview** tab |

## What an offer contains

| Field | |
| --- | --- |
| **The war** | Which conflict you are leaving. |
| **The other party** | A single country on the opposing side. |
| **Indemnity** | Who pays whom, and how much. |
| **Justification** | An optional public note, moderated. Published on the conflict record once accepted. |

### The indemnity

**Either party may be the payer.** This is not a formality: both directions are real plays:

- **The losing side pays to get out.** The obvious case: buy your way out of a war you are losing.
- **The winning side pays to disengage.** Less obvious and just as legitimate. If you are winning a war you no longer want (because the real threat is elsewhere, or the grind is costing more than it is worth) you can pay your opponent to let you leave.

**An indemnity of zero is a clean white peace.** Same mechanism, dialled to nothing. Everybody walks away, no money moves.

**Amounts are always quoted in the payer's local currency**, and converted on the way to the recipient. Every treasury is denominated locally, so moving the raw number would invent or destroy value at the exchange rate.

**There is no affordability check.** A payment can push the payer into the red, which is what national debt is. Requiring a surplus would mean a country already in debt could never buy peace, which is most of the countries that would want to.

## The rules an offer must clear

1. **The war must not already be over.**
2. **Neither side may be a generated force.** You cannot negotiate with an insurgency: there is no government on the other end to address an offer to. The panel says exactly that rather than a confusing "must be a belligerent" message.
3. **Both countries must be belligerents in that war**, by explicit roster membership. Bloc affinity is not enough: a country pulled toward a side by its alliance has not declared war on anyone, and cannot be offered a settlement for a war it never joined.
4. **You must be on opposite sides.** You cannot make peace with an ally.
5. **The indemnity must not be negative**, and the payer must be one of the two parties.

## The 72-turn window

An offer stands for **72 turns** (three real days) then lapses.

The duration is fixed and not negotiable. One less thing to argue about, and a window nobody chooses cannot be chosen badly.

Expiry is **lazy**: an offer that has passed its window is dead whether or not anything has got round to marking it so. It cannot be accepted, rejected or withdrawn after the fact.

## Answering an offer

Three responses, and **who may take them is strictly assigned**:

| Action | Who |
| --- | --- |
| **Accept** | Only the country the offer was made *to* |
| **Reject** | Only the country the offer was made *to* |
| **Withdraw** | Only the country that *made* it |

You cannot accept your own offer.

Everything is **revalidated at acceptance**, not just when the offer was made. An offer sits for up to three real days while the world moves: the war may have ended, or either party may have already left it. A stale deal is refused rather than moving money over a war nobody is fighting.

## What acceptance does

In order:

1. **The offer is claimed.** This is what makes a double-accept impossible: two simultaneous requests can both pass validation, but only one can move the offer off "pending," and the loser applies nothing.
2. **The indemnity moves**: debited from the payer as quoted, converted, credited to the recipient. A white peace moves nothing.
3. **The leaver stands down.** Their general postings at that conflict are dropped, and every unit that was there returns to reserve.
4. **The leaver comes off their side's roster.** The war continues for everyone else.
5. **A 240-turn truce is recorded** between the two parties.
6. **If the leaver was the last country on their side, the war ends outright**: the other side wins, and every remaining cross-side pair is truced too.

That last point is how most negotiated wars actually finish. A two-country war has one country per side, so **the first accepted peace offer ends it**.

## Why it is country-by-country, not side-by-side

Whole-side peace has a fatal failure mode: **one inactive country on a roster could never consent**, and would freeze the war permanently for everybody.

Bilateral peace also follows the consent rule the rest of the system uses: **no player commits another player's army**. Your ally can leave a war without your permission, and you can stay in one they have abandoned.

The practical consequence: **a coalition can be dismantled one member at a time.** Buying out the weakest member of an enemy alliance is a real strategy, and cheaper than beating all of them.

## The 240-turn truce

Every war ending, negotiated, conceded, or won outright, records a **240-turn truce** (about ten real days) between the parties. Neither may declare war on the other until it lapses.

**It is not a negotiated term.** Neither party can trade it away, shorten it, or refuse it. It is a consequence of the war ending, not a clause in the deal.

It exists to stop a country that has just been beaten from being re-declared on the moment the attacker's 120-turn declaration cooldown lapses, at the point it is least able to resist. **The truce deliberately outlasts the cooldown by 120 turns.**

Truces are recorded for **every cross-side pair** when a war ends, not just the principals: otherwise an ally who did the fighting would be free to re-declare while the principal waited. Same-side pairs are never truced; they were not at war with each other.

Your declaration panel lists your live truces and greys out the countries you cannot target, so the bar is visible before you plan a campaign around it.

## Timing: when to sue for peace

**Watch the war's status.** A conflict flips to **Winding Down** when the front has travelled about three-quarters of the way from where it started. That is a public signal:

- If it is winding down **against you**, your offer is about to get much more expensive. Move now.
- If it is winding down **in your favour**, you can demand more, or refuse and finish the job.

**Watch your own attrition.** If your veteran formations are being ground down and rebuilt with conscripts, you may be losing the war you are technically winning. Cheap peace now can be better than an expensive victory in twenty turns.

**Watch the whole board.** A war you are winning still consumes upkeep, manpower and ministerial attention. Paying to disengage from a won war so you can face a real threat elsewhere is a perfectly good use of money.

**Remember the truce is an asset.** Ten real days of guaranteed non-aggression from a rival is worth a great deal. Sometimes a white peace exists to buy the truce, not to end the fighting.

## Practical guidance

**Make sure your foreign minister exists.** A country with no head of government and no foreign seat holder cannot negotiate peace at all, and a defence secretary who filed the declaration cannot fix that themselves.

**Offer early in a losing war.** Territorial position is public. Once you are visibly winding down, your leverage is gone.

**Use white peace liberally.** A zero indemnity that ends a stalemate and buys a 240-turn truce costs nothing and is often the best available outcome.

**Buy out the coalition's weakest link.** You do not have to beat an alliance. You have to make the cheapest member leave.

**Pay to leave a won war.** Winning is not free. If a war has stopped serving your interests, an indemnity you pay to disengage may be far cheaper than the upkeep of continuing.

**Do not expect to negotiate with an insurgency.** Generated forces have no government to address. Those wars end territorially or not at all.

**Track the 72 turns.** An offer that lapses has to be re-made, and in the meantime the front may have moved against you.

## Next

- [Occupation, Territory & Victory](/wiki/occupation-and-victory): the other way wars end.
- [Declaring War](/wiki/declaring-war): the cooldown and truce bars, from the other side.
- [A War, Start to Finish](/wiki/a-war-start-to-finish): a negotiated ending in context.
`;
