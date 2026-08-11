export const noConfidenceVotesContent = `# No-Confidence Votes

A Vote of No Confidence (VONC) is the primary tool for removing a sitting Prime Minister in parliamentary countries. This page covers who can propose one, how voting works, what happens if it passes or fails, and how it connects to snap elections.

## Which countries use this

VONCs apply to parliamentary countries: **UK**, **JP**, and **DE**. The US has no equivalent mechanic: presidents can only be removed through impeachment (future system) or elections.

## Who can propose a VONC

Any MP who is a member of the **ruling party or coalition** can propose a motion of no confidence against the current PM (or Chancellor in DE).

**Requirements:**

- Must be an elected lower-chamber member (Commons MP, Shūgiin member, or Bundestag member)
- Must be in the ruling party or coalition
- No active VONC already exists for the country
- One VONC per PM per 48 turns (1 game year) cooldown after the previous vote resolved

This action is filed from the government page and is scoped to the country you're proposing it in.

## Voting

### Who votes

Only MPs from the **ruling party or coalition** can vote on the VONC. Opposition MPs are not eligible.

**Example:**

- Ruling party: Labour (320 seats)
- Coalition partner: Lib Dem (20 seats)
- Eligible voters: 340 MPs
- Not eligible: Conservatives, SNP, other opposition

### Duration

The voting window is 24 hours from when the motion is proposed. Votes are locked in at window close.

### NPP votes

NPP members of the ruling party/coalition vote as follows:

- If a **whip directive** exists for the VONC, NPPs follow it (deterministic cross-pressure model, same as bill voting)
- If **no whip directive** exists, NPPs automatically vote **Aye** (no confidence) for qualifying party members: this is the default behavior when no whip is present

There are no favorability-based thresholds (e.g., 60+/40-59/<40) governing NPP VONC votes.

### Vote visibility

Live vote totals (Yes / No / Not Voted) are visible to all players on the government page. Individual votes are **secret**: the tally is public but who voted which way is not shown.

## Resolution

When the 24-hour window closes, the vote is tallied.

### VONC fails (PM survives)

- **Threshold:** More than 50% of eligible MPs voted No (confidence)
- The PM retains office
- All active PM appointment votes for the country are **cancelled** (nominees receive a notification explaining why)
- A new VONC cannot be proposed against this PM for 48 turns

### VONC passes (PM removed)

- **Threshold:** More than 50% of eligible MPs voted Yes (no confidence)
- The PM is removed from office immediately
- Cabinet cleared, the officeholder's post cleared
- Government status returns to pending
- The 96-turn PM vacancy clock arms

After removal, existing parallel PM appointment votes continue running in the new pending window. Eligible nominees can also file new appointment votes. The first to secure a majority is seated as the new PM. This parallel-appointment mechanic is how the game models constructive no-confidence: the Bundestag must simultaneously agree on a replacement before the incumbent is removed, and the replacement is seated immediately upon securing a majority.

## VONC and snap elections

A passed VONC does **not** directly trigger a snap election. Instead:

1. VONC passes and government enters a pending state
2. PM appointment votes open for 24 hours each
3. If no PM is seated within 96 turns of the vacancy clock arming, the system auto-triggers a snap election

The 96-turn window is the game's equivalent of the UK's post-FTPA 14-day alternative-government attempt and Japan's 10-day resign-or-dissolve convention.

**Key distinction:** A sitting PM **cannot** preempt an active VONC by calling a voluntary snap election. The snap gate checks for an active no-confidence vote and blocks PM-triggered snaps while one exists.

## VONC-parallel PM nominations

While a VONC is active, the game allows PM appointment votes to be filed even though the government is technically still formed:

- Players can nominate alternative candidates before the VONC resolves
- If the VONC passes, those appointment votes continue running in the new pending window
- If the VONC fails, all active appointment votes are cancelled

This mirrors the UK convention of "constructive" confidence mechanics where an alternative government can be assembled in parallel with the no-confidence vote.

## Strategic considerations

### For the opposition

- **Time it well.** The 48-turn cooldown after a failed VONC is costly. Don't call a VONC unless you have the numbers.
- **Parallel nominations.** File a PM appointment vote for your preferred candidate before or during the VONC. If the VONC passes, your candidate is already in the queue.
- **NPP favorability is decisive.** If the ruling party's NPPs have low favorability toward the PM (below 40), they'll break toward the VONC. High-favorability PMs survive narrow-margin VONCs through NPP support.

### For the PM

- **Monitor ruling party NPP favorability.** If your favorability with your own party's NPPs drops below 40, you're vulnerable to a successful VONC from within.
- **You can't call a snap to escape a VONC.** If an active VONC exists, the snap gate blocks you. Survive the vote first.
- **Building cross-party goodwill** (high favorability outside your coalition) doesn't help in a VONC: only ruling party/coalition MPs vote. Focus on keeping your own house in order.

### For ruling party MPs

- **The cooldown applies to the PM, not to you.** A failed VONC blocks a new one for 48 turns. Weigh whether this cycle is worth spending.
- **A successful VONC resets the legislative clock.** Any bills in the lower chamber that were mid-passage will stay frozen during the pending period.

## Viewing active VONCs

Active VONC status is displayed on the UK Government page (\`/uk/government\`) or JP equivalent. The panel shows:

- Target PM name
- Current Yes / No / Not Voted totals
- Time remaining
- Your vote button (if you are eligible to vote)

## Related pages

- [Government Formation](/wiki/government-formation): PM appointment votes and the full formation process
- [Snap Elections](/wiki/snap-elections): How the 96-turn vacancy clock triggers a snap election
- [Bills & Legislation](/wiki/bills-legislation): The legislation freeze during \`pending\` government status
`;
