# Commons winner's-bonus taper — calibrating `k`

Balance report for tickets **#1276** ("seats not being distributed properly by quota")
and **#1277** ("London election results does not match how many seats I have").

Harness: `scripts/sim/commonsBonusTaper2026-09-05.ts`
World: live (`MONGODB_URI_LIVE`), turn 651, in-game 1965, preset `1953-default`.

## The defect

The FPTP winner's bonus boosts two party groups and squeezes the rest. Slot 1 is the
region's leading party by votes (fixed by #1032). **Slot 2 is the best-ORGANIZED other
party**, and `statePartyOrg.organization` is live state that players move several points
per turn with build-org and poach actions.

Reconstructing organization at each snapshot instant from `orgRegLedger` predicts
**25 of 25** observed seat-vector flips in LON and SCO. The gaps that decided them:

| Region | Turn | Slot-2 contest         | Gap                          | Seats relocated |
| ------ | ---- | ---------------------- | ---------------------------- | --------------- |
| LON    | 645  | SDP 27.37 vs CON 27.02 | **0.35**                     | 9               |
| LON    | 646  | SDP 24.19 vs CON 23.92 | **0.27**                     | 9               |
| LON    | 651  | SDP 12.59 vs CON 11.52 | **1.07**                     | 20 (seated)     |
| SCO    | 647  | CON 24.17 vs LIB 24.17 | **0.00** (party-id tiebreak) | 9               |

This is the identical cliff #1032's own comment describes fixing for slot 1. Slot 2 kept it.

## The proposed rule

Keep the duopoly-vs-rest structure and the boost-only guard. Slot 2 by **pooled votes**,
and bloc membership **tapers** behind the runner-up instead of being all-or-nothing:

```
leader     w = 1
runner-up  w = 1                       (v_R = runner-up pooled votes)
others     w = min(1, (v_g / v_R)^k)

B         = Σ w_g · v_g                bloc mass, replaces pairVotes
sBloc     = B / poolVotes
targetB   = poolVotes · sBloc^n / (sBloc^n + (1-sBloc)^n)
if targetB <= B -> no boost            (existing BOOST-only guard)
scaleUp   = targetB / B
scaleDown = (poolVotes - targetB) / (poolVotes - B)
s_g       = w_g·scaleUp + (1 - w_g)·scaleDown
```

Total is conserved exactly, so largest remainder, seat conservation and determinism are
unchanged. `k → ∞` reproduces the un-tapered hard pair, so the sweep contains it as a
control arm. `n` stays at `UK_COMMONS_FPTP_EXPONENT = 2`.

## Method

Every input is real, and so is the code under test. Vote distributions come from
`electionVoteTallies` for all **48** resolved UK Commons races across all cycles,
including each race's per-turn `turnSnapshots.cumulativeVotes` — **1,248** distributions at
every stage of a count. The OBSERVED arm is not modelled: it is the `seatsEstimate` the
engine actually stored.

Each candidate arm calls the **shipped** `allocateSeats` with `{ exponent, taper: k }`
rather than a local model of it, so the figures below are the behaviour that ships. The
harness originally used its own implementation; re-pointing it at production reproduced
every number in this report byte for byte, which is itself the check that the shipped
rule matches what `k` was calibrated against.

- **Cliff** — nudge the #2 and #3 party groups to a dead heat, then hand each one extra
  vote in turn, and measure seats relocated across that boundary. This is the defect,
  measured directly.
- **Churn** — seats relocated between consecutive turns of the same count.
- **Monotonicity breaks** — a party gains vote share and loses seats, or the reverse.
- **Two-party fall-through** — a pool of exactly two parties must stay exactly
  proportional (the NWE case: CON 20.5% of the vote, 17 of 75 seats).
- **Gallagher index** — √(½ Σ(seat% − vote%)²), national, latest cycle.

## Results

Observed churn under the current rule: **0.63** seats/turn over 1,200 turn pairs.

| k             | churn/turn | max cliff | races w/ cliff | mono. breaks | 3rd+ seat% (of 26.8% votes) | Gallagher |
| ------------- | ---------- | --------- | -------------- | ------------ | --------------------------- | --------- |
| 2             | 0.36       | 1         | 2              | 12           | 16.6%                       | 7.17      |
| **3**         | **0.36**   | **1**     | **3**          | **12**       | **15.0%**                   | **8.10**  |
| 4             | 0.37       | 1         | 3              | 19           | 14.6%                       | 8.37      |
| 5             | 0.39       | 1         | 3              | 23           | 14.1%                       | 8.62      |
| 6             | 0.39       | 1         | 2              | 23           | 13.8%                       | 8.85      |
| 8             | 0.39       | 1         | 2              | 23           | 13.6%                       | 9.00      |
| 10            | 0.39       | 1         | 2              | 19           | 13.1%                       | 9.21      |
| ∞ (hard pair) | 0.38       | **18**    | **20**         | 11           | 12.5%                       | 9.23      |

Two separate wins, cleanly separated by the data:

1. **Votes instead of organization** halves the churn (0.63 → ~0.38). Present in every
   arm including `k = ∞`.
2. **The taper** collapses the cliff from a max of **18 seats across 20 of 48 races**
   (mean 9.85) to **1 seat in 2-3 races** (mean 1.00). One seat is largest-remainder
   rounding and is irreducible.

**Two-party fall-through: 24 races × every arm, 0 deviations from proportional.** NWE
keeps LAB 58 / CON 17 by construction, not by special-casing.

The FPTP squeeze survives at every `k`: third-and-lower parties hold 26.8% of the vote
and 13-17% of the seats.

## Effect on the live chamber

⚠️ **Corrected at turn 652.** An earlier pass of this section re-weighted the ballots
against allocations derived from the tallies, which assume a full 625-seat chamber. The
real chamber is **609** — see "Orphaned seats" below — and more ballots have since been
cast. On the real basis the earlier conclusion that `k=2` fails does **not** hold.

An in-flight confidence motion (Sarah Spencer, Labour) closes turn 674.

| Basis              | Chamber | Majority | Aye     | Nay     | Result     | LAB     |
| ------------------ | ------- | -------- | ------- | ------- | ---------- | ------- |
| real chamber today | 609     | 305      | 332     | 174     | passes     | 313     |
| healed, k=2        | 625     | 313      | 320     | 203     | passes     | 303     |
| **healed, k=3**    | **625** | **313**  | **325** | **206** | **passes** | **307** |
| healed, k=4        | 625     | 313      | 327     | 208     | passes     | 309     |
| healed, k=5        | 625     | 313      | 331     | 207     | passes     | 312     |
| healed, k=6        | 625     | 313      | 332     | 208     | passes     | 313     |

The motion carries under every arm, so the choice of `k` does **not** decide the
government. Healing also restores the chamber from 609 to 625 by reallocating the
orphaned seats.

## Destroyed seats — the Liberal/SDP merge (separate defect, found turn 652)

At turn 651, the turn this election resolved, the **Liberal Party merged into the SDP**
(`isDefunct: true`, `defunctAtTurn: 651`, `mergedIntoPartyId` → SDP).

Commons seats went LAB 313 / CON 193 / SDP 67 / **LIB 26** / PC 26 = **625**
→ LAB 313 / CON 193 / **SDP 77** / PC 26 = **609**.

SDP inherited only 10 of the 26 — Peggy O'Brian (WAL), a **player**, who carried her seats
across. The other 16 belonged to NPPs whose records were deleted outright:

| Region | Candidate    | Party | Seats under current rule | Seats under `k`=3 |
| ------ | ------------ | ----- | ------------------------ | ----------------- |
| SCO    | Tom Marshall | LIB   | 11                       | 2                 |
| SWE    | Joe Holmes   | LIB   | 5                        | 2                 |

**On a merge, players carry their seats; NPP seats are destroyed.** The chamber shrank
silently and the majority threshold fell 313 → 305, changing the passing bar for every bill
and confidence vote. The cause is in the merge path, not the allocator — separate ticket.

Note the interaction: the org fluke is what inflated those two NPPs to 11 and 5 seats. Under
the proposed rule they hold 2 each, so the taper shrinks this failure mode from 16 destroyed
seats to 4 as a side effect, without addressing its cause.

**Heal policy (decided):** the merge is post-election, so the election stands as cast.
Allocate over the full tally including their votes, and leave their seats **vacant** rather
than reallocating to survivors. After the heal: 621 of 625 seated, 4 vacant, threshold 311,
confidence motion carries 323-203.

## Recommendation: `k = 3`

- Ties the best monotonicity score (12 breaks in ~6,000 checks, all largest-remainder
  rounding) with `k=2`.
- Second-closest Gallagher to the status quo 6.88.
- Leaves the runner-up a visible earned edge: WMI's PC (25.0%) takes 16 seats to CON's
  (24.6%) 15. At `k=2` that flattens to 15/15, which reads as the bonus having been
  replaced by plain PR.
- `k=2` was initially excluded for failing the live confidence motion. **That exclusion
  was wrong** — it rested on a 625-seat basis that does not match the real 609-seat
  chamber, and on a ballot snapshot that has since moved. On current data the motion
  carries under every arm, so `k` does not decide the government either way.
- So the `k=2` vs `k=3` call rests solely on the WMI criterion above: whether a genuine
  0.4-point lead should earn anything. A dead heat for a real lead is its own "feels
  bad" and cuts against the principle that votes decide seats. Hence `k=3`.

## Caveats

- Calibrated on one world's UK Commons. The rule is country-agnostic but only
  `commons` / `snap_commons` in pre-1999 in-game years pass a bonus at all, so the blast
  radius is exactly the UK Commons.
- The confidence motion stays open ~23 more turns; its final outcome depends on ballots
  not yet cast, under any rule including the current one.
- `k = 3` moves **49 seats across 9 of 12 regions** if the resolved chamber is healed.
  NEE, NIR and NWE are untouched. Labour goes 313 → 305 and loses its one-seat majority;
  that majority was itself produced by the coin flip this report documents, and the
  confidence motion still carries (316 aye vs 313).

## Heal delta at `k = 3`, per region

| Region | Seats | Seated now                         | Healed                             | Moved |
| ------ | ----- | ---------------------------------- | ---------------------------------- | ----- |
| EAE    | 47    | CON 23, LAB 19, SDP 5              | CON 22, LAB 17, SDP 8              | 3     |
| EMI    | 37    | CON 16, LAB 8, PC 7, SDP 6         | CON 17, LAB 10, PC 8, SDP 2        | 4     |
| LON    | 91    | LAB 43, **SDP 33, CON 15**         | LAB 38, **CON 30, SDP 23**         | 15    |
| NEE    | 27    | LAB 17, CON 10                     | unchanged                          | 0     |
| NIR    | 12    | CON 12                             | unchanged                          | 0     |
| NWE    | 75    | LAB 58, CON 17                     | unchanged                          | 0     |
| SCO    | 71    | LAB 46, CON 14, **LIB 11**         | LAB 43, **CON 26, LIB 2**          | 12    |
| SEE    | 81    | LAB 41, CON 36, SDP 4              | LAB 41, CON 35, SDP 5              | 1     |
| SWE    | 43    | CON 13, LAB 10, PC 8, SDP 7, LIB 5 | CON 16, LAB 12, PC 7, SDP 6, LIB 2 | 5     |
| WAL    | 36    | LAB 19, LIB 10, CON 5, SDP 2       | LAB 19, LIB 10, CON 6, SDP 1       | 1     |
| WMI    | 53    | LAB 20, **CON 16, PC 11**          | LAB 20, **PC 16, CON 15**          | 5     |
| YHU    | 52    | LAB 32, CON 16, SDP 4              | LAB 30, CON 15, SDP 7              | 3     |

National: LAB 313 → 305, CON 193 → 221, SDP 67 → 54, PC 26 → 31, LIB 26 → 14.

Every bolded change is a case where the bonus had gone to a party that placed **third**
on votes. WMI is the taper working as designed: PC (25.0%) and CON (24.6%) end one seat
apart instead of five.
