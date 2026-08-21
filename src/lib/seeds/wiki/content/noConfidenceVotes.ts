export const noConfidenceVotesContent = `# No-Confidence Votes

A Vote of No Confidence (VONC) is the parliamentary route for removing a sitting Prime Minister, Chancellor, or Taoiseach. It is a whole-chamber test: the government stays in office unless the motion wins the required number of lower-chamber seats.

## Where VONCs apply

VONCs apply in live parliamentary countries: **UK**, **JP**, **DE**, and **IE**. Presidential countries use elections or [Impeachment](/wiki/impeachment). One-party states use their internal confidence system instead of this generic motion.

## Proposing a motion

Any sitting member of the country's lower chamber may propose a VONC. The proposer does not have to belong to the government, ruling party, or coalition.

Requirements:

- A government is formed and has a sitting executive
- The proposer holds the country's lower-chamber office, such as MP, Shūgiin member, Bundestag member, or TD
- No VONC is already active in that country
- At least 48 turns have passed since the previous VONC was proposed

The one-party-state command guard is stricter, but those countries do not currently expose this generic confidence-vote mechanism.

## Voting

Every sitting lower-chamber member may vote **Aye** for no confidence or **Nay** to keep the government. Opposition members are eligible. Seats may carry a weight greater than one in a grouped official record, so the tally is seat-weighted.

The voting window lasts 24 hours. The government page shows Aye, Nay, and not-voted totals while individual player votes remain private.

### NPP party-line voting

NPP members vote along the chamber's government/opposition split unless their party has issued a whip:

- Government and coalition NPPs default **Nay**
- Opposition NPPs default **Aye**
- An NPP with no party does not cast a party-line vote
- A party whip overrides the default

This pass runs during the vote and again before resolution so NPP-held benches are included in the result.

## Passing threshold

A VONC needs the government's stored chamber-majority threshold. If that value is unavailable, the engine uses \`floor(total lower-chamber seats / 2) + 1\`.

This is a majority of the **whole chamber**, not a majority of votes cast. Abstentions and unvoted seats therefore count against the motion. A tie does not remove the government.

## If the motion fails

- The executive stays in office
- PM appointment votes filed during the active VONC are cancelled
- The 48-turn filing cooldown still applies from the turn the motion was proposed

## If the motion passes

- The executive is removed immediately
- Cabinet and officeholder fields are cleared
- Government status returns to pending
- The 96-turn vacancy clock starts
- PM appointment votes already filed during the VONC remain active

New appointment votes can also be filed during the pending period. The first eligible nominee to win the required appointment vote takes office.

## VONCs and snap elections

A passed motion does not immediately call an election:

1. The VONC passes and government becomes pending
2. Appointment votes may run for 24 hours each
3. If no executive is seated within the 96-turn vacancy window, the system can auto-trigger a snap election

A sitting executive cannot use a voluntary dissolution to escape an active VONC. The snap-election gate blocks that action until the confidence vote resolves.

## Practical play

### Opposition

- Count the entire chamber, including abstentions and seats that may not vote
- Whip your NPP benches before resolution
- File a replacement appointment vote during the VONC if your preferred nominee is eligible

### Government

- Government NPPs already default to Nay, but a whip makes the direction explicit
- Opposition votes count, so controlling only coalition discipline is not enough if the chamber majority has shifted
- You cannot call a snap election while the VONC is active

## Related pages

- [Government Formation](/wiki/government-formation): Appointment votes and the pending-government process
- [Snap Elections](/wiki/snap-elections): Voluntary dissolution and the vacancy clock
- [Bills & Legislation](/wiki/bills-legislation): The legislation freeze while government is pending
`;
