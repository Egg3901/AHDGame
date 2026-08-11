export const snapElectionsContent = `# Snap Elections

Parliamentary countries (UK, JP, and DE) can dissolve their lower chamber **before** its regular term ends. This creates an early general election, a **snap**. The US has no snap mechanic: it does not have a no-confidence mechanism.

Snaps can happen two ways: a sitting Prime Minister (or Chancellor in DE) calls one voluntarily, or the system auto-triggers one when a PM vacancy extends beyond 96 turns.

For the regular cycles see [United Kingdom](/wiki/united-kingdom), [Japan](/wiki/japan), and [Germany](/wiki/germany). For the underlying confidence mechanics see [No-Confidence Votes](/wiki/no-confidence-votes) and [Government Formation](/wiki/government-formation).

## Where snaps are possible

| Country | Snap-eligible? | Lower chamber | Snap election type |
| --- | --- | --- | --- |
| 🇬🇧 UK | Yes | Commons | Snap Commons election |
| 🇯🇵 JP | Yes | Shūgiin | Snap Shūgiin election |
| 🇩🇪 DE | Yes | Bundestag | Snap Bundestag election |
| 🇺🇸 US | No | N/A | N/A |

Upper chambers (UK Lords, JP Sangiin, DE Bundesrat) are explicitly excluded. Lords isn't elected at all, the Sangiin has its own fixed cycle independent of snaps, and the Bundesrat is appointed by Land governments.

## Player trigger: PM-initiated snap

A sitting Prime Minister (or Chancellor in DE) can call a snap election at any time, subject to gates:

- Snap elections must be allowed for the country. This follows from government type: parliamentary monarchies (UK, JP) and parliamentary republics (DE, IE) allow them by default; presidential and one-party systems don't. A country's configuration can override this default.
- Their government must be formed (not pending or caretaker).
- A PM can call at most 2 snaps per appointment. The counter resets on a new PM.
- If they've used a snap this appointment, a 336-turn cooldown (2 real weeks) must have elapsed.
- **No active no-confidence vote** exists for the country. A PM cannot preempt a pending VONC with a snap (admin overrides bypass this).

You call a snap from the government page's snap-election action.

### What happens on a successful snap

In order, atomically:

1. All active or upcoming regular lower-chamber elections are **cancelled**.
2. **In-progress bills in the lower chamber** anywhere in its voting or override process fail. Bills currently in the upper chamber (Lords, Sangiin), or in JP's cabinet-review or enrolled stage, are preserved: their chambers are not dissolved.
3. A snap election spawns **per region** for the lower chamber (active status, primary opens immediately, 48-hour total window: 24h primary + 24h general).
4. The country's snap-usage counter increments and its last-snap turn is recorded.
5. **The sitting PM is vacated**: cabinet cleared, the officeholder loses their post (both the character and any NPP holding it), government status returns to pending, and the 96-turn PM vacancy clock arms.
6. Government cycle and seat counters reset automatically.
7. A Discord game event emits.

Note: the 48-hour snap window is **much faster** than a regular Commons cycle (240 turns) or Shūgiin cycle (192 turns). Snap campaigns are sprints: make every action count.

## Auto-trigger: PM vacancy deadline

When the government enters a pending state (post-election reset, no-confidence pass, admin vacate, whatever), a 96-turn clock arms.

If no new PM is seated before the deadline, the game automatically triggers a snap election, ignoring the usual cooldown and usage caps.

The deadline clears when:

- A PM appointment vote passes.
- An admin directly appoints a PM.
- Any other flow seats a PM.

### Why a single vacancy clock replaces a "no-confidence, then snap" rule

A successful no-confidence vote already transitions the government into a pending state, the same state any PM vacancy reaches. Folding no-confidence into the shared vacancy clock means the game doesn't need to distinguish "snap because of no confidence" from "snap because no party can form a majority." The 96-turn window scales the UK post-FTPA 14-day alternative-government window and JP Article 69 10-day resign-or-dissolve convention to the simulation's timeline.

## Post-snap cycle reset

Snap elections shift the regular cycle forward. The next regular lower-chamber election anchors to the snap's end time, not to the original bootstrap date:

| Country | Regular cycle length | Next regular election's end turn |
| --- | --- | --- |
| UK Commons | 240 turns (5 game years) | Snap's end turn + 240 |
| JP Shūgiin | 192 turns (4 game years) | Snap's end turn + 192 |
| DE Bundestag | 192 turns (4 game years) | Snap's end turn + 192 |

The cycle counter increments: a snap that resolves at cycle N is followed by a regular cycle N+1 whose end turn sits 240 (UK) or 192 (JP, DE) turns after the snap's end turn.

## What a snap does not touch

- **Upper chambers** (Lords, Sangiin) are unaffected. Their elections and seats persist.
- **Bills in the upper chamber** are preserved, as are bills in JP's cabinet-review or enrolled stage.
- **Non-lower-chamber regional councils** or devolved assemblies (e.g., Scottish Parliament, future DE state parliaments) are independent of the national snap.
- **Money, actions, stats** of individual players: nothing is reset. You keep everything.

## Strategic considerations

### For the Prime Minister

- **Calling a snap is a commitment to win it.** You lose your office at the moment the snap fires. Whether you regain it depends on the result and confidence process.
- **Timing on momentum.** Historically (and in-game) PMs call snaps when polling favours them. Consult polls before deciding.
- **Maximum 2 per appointment.** You can't spam snaps.
- **336-turn cooldown between voluntary snaps in same appointment.** Plan accordingly.

### For opposition MPs

- **Watch the PM vacancy clock.** If the government is pending and no PM formation vote is imminent, auto-snap is ~96 turns out. Prepare campaign operations now.
- **Bills fail on snap.** If you had legislation mid-passage in the lower chamber, it's gone. Re-propose after the snap.
- **48-hour sprint.** Every turn of the snap general accumulates votes. There's no "build phase": all the build is done before the snap fires.

### For candidates (any party)

- **Incumbency is tenuous.** Sitting MPs have their seats open just like everyone else. Your Political Influence and Favorability persist, which is a huge advantage, but you still have to run.
- **Party organization is multiplied.** With the short 48-hour window, party org (the 0.5× to 1.0× scalar) matters disproportionately to individual campaigning.
- **NPP endorsements land harder.** The compressed window means fewer opportunities for Favorability swings; NPP endorsements (each a demographic appeal boost) are near-decisive.

## Related

- [United Kingdom](/wiki/united-kingdom): UK political system, Commons, PM formation.
- [Japan](/wiki/japan): JP political system, Diet, PM formation.
- [Election Mechanics](/wiki/election-mechanics): General election vote math.
- [General Elections](/wiki/general-elections): Closing sprint tactics (same math applies to snap).
- [No-Confidence Votes](/wiki/no-confidence-votes): VONC mechanics.
- [Government Formation](/wiki/government-formation): PM formation and confidence votes.
`;
