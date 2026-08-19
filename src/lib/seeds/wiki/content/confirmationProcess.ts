export const confirmationProcessContent = `# Confirmation Process

The US Senate must confirm presidential nominations for Cabinet positions before the nominee can take office. This page explains how the confirmation vote works, what can block it, and how timing affects strategy.

## What requires Senate confirmation

- All 15 Cabinet positions (see [Cabinet](/wiki/cabinet))
- Future: Federal judges and other Senate-confirmed appointments

Parliamentary countries (UK, JP, DE) do not use Senate confirmation. Cabinet members there are appointed directly by the Prime Minister (UK, JP) or Chancellor (DE). See [Government Formation](/wiki/government-formation).

## How confirmation works

### Step 1: Presidential nomination

The President nominates a character for a specific cabinet position. This creates a pending cabinet nomination record and opens the confirmation process.

### Step 2: Senate vote opens

Once a nomination is submitted, a confirmation vote opens in the Senate. All sitting Senators (players and NPPs) are eligible to vote.

**Vote options:** Confirm or Reject. Abstentions count as neutral.

**Threshold:** Simple majority. Confirm votes must exceed Reject votes.

**Duration:** The vote follows the standard bill voting window mechanics. Senators have 24 hours to cast their votes.

**One pending nomination per position.** Only one nomination can be pending for a given cabinet position at any time. The President must wait for the current vote to resolve (or withdraw the nomination) before submitting a new one.

### Step 3: NPP senator votes

NPP Senators auto-vote on confirmations using logic similar to bill voting:

- **Party alignment.** NPPs from the President's party lean toward confirming; opposition NPPs lean toward rejecting.
- **Personal favorability.** NPPs with high favorability toward the nominee are more likely to confirm regardless of party.
- **Loyalty trait.** High-loyalty NPPs follow party guidance more strictly; low-loyalty NPPs may cross party lines.

### Step 4: Resolution

When the voting window closes, the turn processor tallies votes.

- **Majority confirms:** The character takes office as the Cabinet member, and the position is marked filled.
- **Majority rejects:** The nomination fails. The position remains vacant. The President can submit a new nomination for the same position immediately.
- **If the vote ends in a tie:** The nomination fails. Confirmation requires a strict majority of Confirm votes over Reject; there is no Vice President tie-break here, unlike on Senate bills.

## What can block a confirmation

### Senate opposition

The most direct block: if the opposition party controls the Senate and votes as a bloc, they can reject any nominee. This is the normal mechanism of divided government.

NPP vote reliability is not 100%: some NPPs will cross party lines based on the nominee's favorability. A highly popular nominee may pull a few opposition NPP votes.

### Withdrawn nomination

The President can withdraw a nomination at any time before the vote closes. This returns the position to vacant without a formal rejection.

### No Senate vote scheduled

If the President hasn't nominated anyone, there's nothing to confirm. Strategic use of this: the opposition can't reject a nominee who hasn't been named. Leaving a position vacant has costs (no department head) and benefits (no confirmation battle).

## Strategic considerations

### For the President (nominating)

- **Pick a confirmable candidate.** If you're in divided government, nominating an ideologically extreme character will fail. Consider a more centrist nominee who can pull opposition NPP votes.
- **Time nominations with Senate dynamics.** If you're about to gain Senate seats (after an election), delay a controversial nomination until the new senators are seated.
- **Use nominations as leverage.** Offering a coveted Cabinet seat to a player from an opposing party (in exchange for legislative support) is a legitimate bargain.

### For the Senate (confirming or rejecting)

- **Confirmation votes are leverage.** Blocking a Cabinet nominee forces the President to negotiate. Use it.
- **Target strategically.** Not all Cabinet positions carry equal weight. Secretary of State and Treasury matter more to most players than more specialized roles.
- **NPP management.** Whipping your party's NPP bloc on a confirmation vote works the same as on a bill. Issue a party directive before the vote opens.

### For Nominees

- **Favorability matters.** High personal favorability can pull opposition NPP votes. Build relationships across party lines before you expect to be nominated.
- **Policy alignment.** NPP votes on confirmation are influenced by how well your personal policy positions align with theirs. A nominee far from the median Senator will face harder confirmation.

## Failed nominations

A failed nomination has no cooldown: the President can renominate the same character or someone new immediately. However, a publicly failed confirmation is politically costly. The nominee's favorability may take a hit, and the President's leverage on future nominations is weakened.

## Tracking nominations

Pending nominations appear on the executive dashboard visible to the President. The Senate floor tracker shows open confirmation votes alongside regular bills. All players can see which positions are filled or vacant from the Cabinet page.

## Related pages

- [Cabinet](/wiki/cabinet): The 15 Cabinet positions and what each does
- [Congress Leadership](/wiki/congress-leadership): Senate Majority Leader's role in scheduling confirmation votes
- [Voting & Whips](/wiki/voting-and-whips): Whipping NPP senators on confirmation votes
- [Government Formation](/wiki/government-formation): Parliamentary equivalent (no Senate confirmation)
`;
