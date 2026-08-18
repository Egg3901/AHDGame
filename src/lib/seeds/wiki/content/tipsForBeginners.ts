export const tipsForBeginnersContent = `# Tips for Beginners

Starting out in A House Divided can be overwhelming: there are 50 US states, continuous elections, a live economy, and a political simulation running 24/7. These tips will save you the most common beginner mistakes in your first few game weeks.

---

## 1. Spend all your actions every turn

You start with 4 actions per turn (refreshed every real hour). Actions **do** roll over up to a cap of 200, but above 100 you pay a −4 hoarding penalty per turn that slows growth. Don't stockpile forever. Spend them. Even low-value actions (running a poll, building a donor network) are better than letting them sit idle.

---

## 2. Join a party before you declare

You cannot win a primary as an independent against party-backed candidates. The party platform alignment score is worth up to 40 points, and running independent means a 0.3x general election penalty. Find a party whose platform econ/social coordinates are close to your character's ideology and join before you declare your first candidacy.

---

## 3. Poll before declaring for any office

A Quick Poll costs 2 actions and ₳25,000. It shows your topline appeal in the race and the 5 demographics where you're strongest and weakest. Never declare a candidacy without running a poll first: you might be walking into a race where you'll score 25 on the primary scale against an NPP scoring 45 (effective 22.5 with the penalty).

---

## 4. Canvass where you're active

Canvassing targets one state at a time. For most characters that's your home state. Attempting to canvass elsewhere returns an error and wastes your action. Presidential candidates are the exception: they canvass in whichever state they've traveled to (general phase) or set as their primary campaign state (primary phase). Everything else (ads, endorsements, political influence spending) can work cross-state, but canvassing is tied to where you're physically active.

---

## 5. Don't skip demographics early

The demographics page shows your state's voter archetype breakdown: which groups are large, which have high turnout, which lean your way. Reading it once before your first campaign tells you which groups to target with ads and which to canvass. Ignoring demographics means your ad budget goes in random directions.

---

## 6. Understand what turn processing does

Every hour, on the hour, the game processes a turn:
- Your actions refresh
- Elections accumulate votes (or resolve)
- Bills advance
- Party GOTV runs
- Demographic turnout modifiers decay

You can check the turn log in the admin UI (or as a normal player, watch the turn timer) to know when the next turn fires. Canvassing and ads you submit mid-turn take effect immediately: you don't need to wait for turn processing for your actions to count.

---

## 7. Watch the campaign season window

In the final 4 turns (4 real hours) before any election ends, all campaign passive effects **double**. This includes:
- Canvassing alignment multiplier x 2
- Media Spending favorability boost x 2
- Opposition Research debuff x 2

This is the most important tactical timing in the game. Save your biggest canvassing runs for the last 4 turns, not earlier.

---

## 8. Political Influence (PI) takes time to build

PI is a stat you build by running Campaign actions in your home state. It grows by +1 per action, with 0.75% decay per turn. To get from 0 to 40 PI, plan on roughly 10 turns if you're spending most of your actions on Campaign each turn, or significantly longer if you're splitting actions across other activities.

Do not declare a candidacy with PI under 30. You will lose.

---

## 9. Start with the lowest office

Don't go straight for Senate. A State Senate or House seat is far more achievable for a new character. These offices also give you action bonuses (+1/turn) and legislative access, letting you build PI and favorability while holding office. Use the office as a launching pad for the next race.

---

## 10. Party organization matters more than you think

The party organization (Org) stat for your home state affects two things: your vote total in general elections (0.5x to 1.0x scalar) and your presidential primary score (up to 25 points). If your party's home-state org is low, every candidate in that party is penalized. Coordinate with your party chair to invest in org.

Presidential races also have **your own** per-state organization, built on the Presidential Election page. That is not party org. Maxing a state (level 10) is +25% primary vote weight there. Start investing before you file.

---

## 11. Infamy is permanent (and costs you)

Every action that generates infamy (attacking opponents, defying whip votes, certain legislative plays) adds permanently to your infamy score. High infamy reduces NPP endorsement chances and affects certain approval ratings. Don't attack opponents carelessly. Only attack when the favorability damage to them outweighs your infamy cost.

---

## 12. Watch the timer on elections

Elections in A House Divided have fixed timers: the primary phase closes at a set deadline, and you cannot declare after that. The general phase closes at its own end time. Missing the primary window means you wait a full cycle (2-6 game years depending on the office). Check the elections page early in each cycle.

---

## 13. Your character country is permanent

The country you pick at character creation determines which country's elections, legislature, and parties you can participate in. Relocation to another country is possible but wipes party membership, national influence, and any national-level positions. If you want to try the UK or Japan system, plan for it from the start.

---

## 14. Read existing legislation before proposing

Legislation that already exists as active policy cannot be duplicated. Before introducing a new bill, check the state and federal legislation pages to see what's already in effect. Proposing a bill that does the same thing as an existing policy wastes your bill slot and actions.

---

## 15. Check the turn log for what changed

After each turn, the turn log (visible in your notifications or admin turn history) shows what resolved: which elections finished, which bills passed, what NPPs did. If something unexpected happened (your candidate was withdrawn, a bill failed), the answer is usually in the turn log.

---

## Related

- [Getting Started](/wiki/getting-started): character creation and first steps.
- [The Game Loop](/wiki/the-game-loop): how turns and elections run over time.
- [Stats & Actions](/wiki/stats-actions): complete action cost reference.
- [Primaries](/wiki/primaries): declaration rules and primary score formula.
- [FAQ](/wiki/faq): answers to common questions.
`;
