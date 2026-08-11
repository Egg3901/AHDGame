export const governmentFormationContent = `# Government Formation

In parliamentary countries (UK, JP, and DE), elections don't automatically produce a government. After the lower chamber results are in, parties must negotiate and win a confidence vote to seat a Prime Minister (or Chancellor in DE). This page covers that process from election night through a functioning government.

## Which countries use this

| Country | Government type | Formation process |
| --- | --- | --- |
| US | Presidential | President elected directly; no formation vote |
| UK | Parliamentary | PM must hold confidence of Commons |
| JP | Parliamentary | PM must hold confidence of Shūgiin |
| DE | Parliamentary | Chancellor must hold confidence of Bundestag |

These mechanics apply to any parliamentary-style country (parliamentary monarchies, parliamentary republics, and one-party states) that uses a confidence-vote mechanism. Parliamentary monarchies and republics use one by default; one-party states don't, so the freeze does not apply to CN.

## Government status

Each country's government is tracked as either formed or pending:

- **Formed**: A PM is seated and the government is active. Legislation proceeds normally.
- **Pending**: No PM is seated. The government is in formation. Legislation is **fully frozen**.

## The legislation freeze

While the government is pending:

- No new bills can be proposed in the lower chamber
- Cabinet bills cannot be proposed or voted on
- Bills already in progress stay paused in their current status
- The freeze lifts automatically the turn after a PM is seated

This freeze is intentional: governments don't legislate without a mandate.

## How formation works after an election

When a lower-chamber general election resolves:

### Step 1: seat count update

The turn processor reads the election results and updates each party's seat count. This determines who has the numbers to form a government.

### Step 2: confidence motion for incumbent PM (if applicable)

If the current PM **retained their seat** in the election, the system automatically files a **Confidence Motion**, a special PM appointment vote tied to the incumbent. The PM stays in office during the 24-hour vote window.

- If the motion **passes**, the PM continues. Sibling appointment votes are cancelled.
- If the motion **fails** (and no alternative PM has been seated), the PM is removed, government status returns to pending, and the legislation freeze activates. The 96-turn vacancy clock arms.
- If the incumbent **lost their seat**, no confidence motion is filed. The government enters a pending state and the vacancy clock arms.

### Step 3: PM appointment votes

Any eligible character can be nominated as PM by filing a PM appointment vote. Appointment votes:

- Last 24 hours each
- Are voted on by all lower-chamber members (Commons MPs or Shūgiin members)
- Require a simple majority of votes cast to pass

Multiple appointment votes can be open simultaneously. The first candidate to reach a majority wins. When one passes, all others are cancelled.

### Step 4: PM seated

When a PM appointment vote passes:

- The character is installed as PM
- Their officeholder record is updated
- Government status becomes formed
- The legislation freeze lifts next turn
- The vacancy clock clears

The new PM then builds their cabinet by appointing ministers directly (no Senate confirmation equivalent in parliamentary systems).

## Coalition governments

If no single party holds a Commons or Shūgiin majority, a PM candidate typically needs coalition backing. Coalition formation in the game is an informal negotiation between player party chairs:

1. Party chairs discuss coalition terms in-game or out-of-band
2. A player from the coalition's leading party files the PM appointment vote
3. Coalition partner MPs (player and NPP) vote For to provide the majority
4. If passed, the PM's coalition affiliation and coalition partner parties are recorded

NPP coalition partner MPs vote For based on ideology alignment and favorability toward the nominee: they aren't automatically yes votes just because their chair agreed.

## VONC-parallel nominations

PM appointment votes can also be filed while a Vote of No Confidence (VONC) is active against the sitting PM. This allows the opposition to nominate an alternative before the existing PM is removed:

- Both the VONC and the appointment votes run concurrently
- If the VONC passes, the incumbent is removed and the appointment votes continue in the new pending window
- If the VONC fails, all active appointment votes are cancelled

See [No-Confidence Votes](/wiki/no-confidence-votes) for details.

## The 96-turn vacancy clock

Any time the government enters a pending state, post-election, VONC pass, or PM resignation, a 96-turn clock arms: the deadline is set to the current turn plus 96.

96 turns = 96 real hours = approximately 2 game years.

If no PM is seated by the deadline, the game auto-triggers a snap election, bypassing normal PM limits. This is the system's safety valve against indefinite political paralysis.

The clock clears when:
- A PM appointment vote passes
- An admin directly appoints a PM

## Post-formation cabinet

After seating as PM, the character can appoint cabinet members directly from the government page. There is no Senate equivalent: parliamentary cabinets are appointed by the PM without a confirmation vote.

## Watching formation in real time

The UK Government page and equivalent JP page show:

- Current government status (formed or pending)
- The sitting PM name and party (if formed)
- Active PM appointment votes and their current tallies
- Time remaining on appointment votes
- Seat distribution by party

## Related pages

- [No-Confidence Votes](/wiki/no-confidence-votes): How to trigger and vote on a VONC
- [Snap Elections](/wiki/snap-elections): What happens when the vacancy clock expires or the PM calls a snap
- [Bills & Legislation](/wiki/bills-legislation): How the legislation freeze works and when it lifts
- [Cabinet](/wiki/cabinet): Cabinet positions and how the PM appoints them in parliamentary systems
`;
