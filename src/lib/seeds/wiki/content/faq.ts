export const faqContent = `# Frequently Asked Questions

---

## Elections & candidacy

**Why can't I run for Senate?**

The US Senate uses staggered classes, so only one-third of seats (one class) are up in any given cycle. The seat you want may simply not have an active election right now. Check the elections page for your state; if there's no Senate race listed, the class for that seat isn't up yet. Additionally, you must be in the primary window to declare. If that window closed, you wait until the next cycle.

---

**Why did I lose the primary?**

Primary scores are calculated at the moment the primary window closes. The highest score per party advances. Your score has three components: party alignment (0 to 40), favorability (0 to 35), and political influence (0 to 25). Common reasons for losing:

- Your policy position (econ/social) was too far from the party platform. Each point of Manhattan distance costs 2 alignment points.
- Your favorability was below 55 to 60. At 50 favorability, you're only contributing 17.5 of a possible 35 points.
- An NPP scored higher than you without the penalty (NPPs only get the 0.5× penalty if at least one player is in the primary).

Run a Quick Poll before declaring: it shows your projected primary score before you commit.

---

**Why do I keep getting 403 errors when trying to canvass?**

Canvassing targets one state at a time. For most characters that state is your home state, so submitting a different state returns an error. If you moved recently using the relocation action, your home state may have updated. Check your character profile to confirm your current home state. Presidential candidates are the exception: they canvass in whichever state they're currently traveling to during the general phase, or their primary campaign state during the primary phase. If you haven't set those yet, the canvassing panel disables itself and prompts you to travel to a state first.

---

**How do I get more actions per turn?**

Base actions: 4 per turn. Actions increase by holding offices with action bonuses:

- President / PM / Chancellor: +4
- Vice President: +2
- Senator (US): +2
- Governor (US): +2
- Federal Reserve Chair / Bank governor: +3
- House Representative: +1
- State Senator: +1

A Senator who is also Fed Chair gets 4 + 2 + 3 = 9 actions per turn. Party influence can also grant bonus actions.

---

**What happens when an election I'm running in resolves?**

If you win: your character receives the office, you start receiving office-based action bonuses and income, and the next election cycle is spawned. If you lose: your candidacy is marked withdrawn and you receive a notification. Your favorability and PI carry into the next cycle: nothing is reset.

---

**Can I run in two elections at the same time?**

No. An active candidacy blocks new declarations. You must withdraw from your current race before declaring in a different one. Withdrawing from a race you're losing is sometimes worth it if a better race is opening, but you cannot re-enter the race you withdrew from.

---

**What is the NPP primary score penalty?**

When at least one player is in a party's primary, all NPP candidates in that same party's primary receive a 0.5× multiplier on their total primary score. This means a 70-point NPP competes at an effective 35, so most competent players will beat them. The penalty does not apply if no players are in the race.

---

## Game time & turns

**What is a game turn? What is a game year?**

One real-world hour = one game turn = one game week. 48 turns = one game year. Elections, bill deadlines, and term lengths are all measured in real hours (which equal game weeks).

**What happens when turn 48 ends?**

The year counter increments (e.g., year 1 to year 2) and turn counting restarts at turn 1. The fiscal year processes at turn 36 (the game-year equivalent of October). There is no game reset: the simulation continues indefinitely.

---

**When does the next turn fire?**

Turns fire at the top of every real hour (e.g., 14:00, 15:00, 16:00). You can see the countdown timer on the game dashboard. In fast mode, turns fire at :00 and :30.

---

## Legislation

**How do I propose a bill?**

Go to the Congress or legislature page for your country. Use the "Propose Bill" action. Bills cost actions to introduce and may require a character with a legislative seat (House/Senate/Commons/etc.) to sponsor them. You set the bill's policy effects and choose which chamber it starts in.

---

**Why did my bill get stuck in committee?**

Bills need committee votes to advance to the floor. NPPs and other player legislators must vote yes. If your bill's effects are ideologically misaligned with the committee's ideology distribution, NPPs will vote against it. Check the ideology breakdown of your committee members and adjust the bill's policy direction accordingly, or use whip directives if you control party leadership.

---

**Can a President veto a bill?**

Yes. After a bill passes both chambers, the President (or PM/Chancellor) can sign or veto it. A vetoed bill fails and cannot be reintroduced in the same cycle. Coordinate with the executive branch before pushing legislation that the current executive might veto.

---

## Parties & organizations

**How do I start a new political party?**

You draft a **Party Charter** on the new-charter page: name, abbreviation, four-axis platform, and three human founders (yourself plus two others). Your two co-founders must live in your home state or a state adjacent to it, since a new party's founding trio is geographically anchored, just like its founding NPP cohort. Once all three founders sign on the charter's page, the charter ratifies, the party is created, and all three founders are joined to it as members. The party starts with **vacant leadership**: its first leadership elections open immediately and end on the same shared cycle as every other party's, so declare your candidacy on the party page. Your new party has zero state org, so building that from zero takes time. See [Political Parties](/wiki/political-parties) for the full charter lifecycle (rejections, founder replacement, expiry).

---

**What is Party Organization (Org)?**

Party organization (Org) is a 0 to 100 metric per state that represents your party's ground-level infrastructure. It affects two things: general election vote totals (a 0-org state cuts your votes in half; a 100-org state applies the full 1.0× scalar) and presidential primary scores (up to 25 pts based on home-state org). The party chair controls org investment.

---

**What are whip directives?**

Whip directives are instructions the party leadership sends to NPP legislators on how to vote on specific bills. If the whip says "aye," NPP party members will vote yes on that bill. If "nay," they vote no. This is how party chairs influence legislative outcomes even when they don't hold every seat.

---

## Economy & finance

**What do corporations do?**

Corporations own economic sectors within countries. Each turn, sectors generate revenue based on sector size, policy environment, and economic conditions. Revenue flows to the corporation as income, which pays out to shareholders (including your character). Running a corporation alongside a political career provides passive income that funds campaigns and ads.

---

**What are sovereign bonds?**

Governments issue bonds to raise capital. As a player, you can buy these bonds to earn interest (coupon payments) over time. Bond yields vary by country credit rating and economic health. Bonds mature after a set period and return their face value. Defaults are possible if a country's fiscal situation deteriorates severely.

---

**What is the Forex system?**

When Forex is enabled, you can trade currencies: USD, GBP, EUR, and JPY. Exchange rates shift based on each country's inflation, trade balance, and interest rate differentials. Central bank chair characters influence rates through interest rate policy. Limit orders allow you to set automatic buy/sell prices.

---

## Characters

**Can I change my home state?**

Yes, via the relocation action. Relocating costs actions and funds, and there is a cooldown period. After relocating, your home state updates for canvassing and future elections. You cannot change which country your character belongs to.

---

**What is infamy?**

Infamy is a permanent stat that increases when you take certain negative actions (attacks, defying whip votes, certain legislative plays). Higher infamy reduces your chance of receiving NPP endorsements and affects some approval calculations. Infamy does not reset.

---

**What is NPI (National Political Influence)?**

NPI is your national-level reputation, distinct from state-level Political Influence (PI). NPI grows from holding high offices, national legislation, and accumulating state PI over time. NPI is the primary influence stat for presidential primary scoring and national vote accumulation in presidential races.

---

## Related

- [Tips for Beginners](/wiki/tips-for-beginners): Practical new player advice.
- [Glossary](/wiki/glossary): Definitions of all game terms.
- [Getting Started](/wiki/getting-started): First steps guide.
- [Reference: Formulas](/wiki/reference-formulas): Complete formula reference.
`;
