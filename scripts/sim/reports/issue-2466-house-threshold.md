# Issue #2466 US House delegation-aware threshold

Date: 2026-09-27
Source: read-only `MONGODB_URI_LIVE` snapshot
Harness: `scripts/sim/issue2466HouseThreshold.ts`

## Question

Compare the current flat 20% US House party eligibility gate with the proposed
delegation-aware rule:

```text
threshold = clamp(1 / (authoritativeSeats + 1), 10%, 20%)
```

The comparison holds each state's current active field and cumulative vote
distribution constant. It changes only the eligibility gate, then runs the
production party-quota allocator. Output is aggregated by party and delegation
magnitude; no candidate or player identities are collected or reported.

## Snapshot

- Turn: 1180
- Game year: 1976
- Preset: `1953-default`
- House cycle: 12
- State races: 50

## National result

| Party                                 | Vote share | Flat 20% seats | Proposed seats | Delta |
| ------------------------------------- | ---------: | -------------: | -------------: | ----: |
| Democratic Party                      |     29.20% |            163 |            128 |   -35 |
| Republican Party                      |     23.69% |             85 |            101 |   +16 |
| Farmer-Labor Party                    |     22.39% |             70 |            101 |   +31 |
| Constitutional Union Party            |     13.49% |             99 |             63 |   -36 |
| Federalist Party of the United States |      5.98% |             15 |             24 |    +9 |
| Conservative                          |      5.25% |              3 |             18 |   +15 |

Both arms allocate exactly 435 seats.

## Delegation-magnitude result

| Delegation seats | Proposed gate | States | Seats | Changed states |
| ---------------: | ------------: | -----: | ----: | -------------: |
|                1 |        20.00% |      7 |     7 |              0 |
|                2 |        20.00% |      6 |    12 |              0 |
|                3 |        20.00% |      4 |    12 |              0 |
|                4 |        20.00% |      4 |    16 |              0 |
|                5 |        16.67% |      3 |    15 |              2 |
|                6 |        14.29% |      3 |    18 |              1 |
|                7 |        12.50% |      1 |     7 |              0 |
|                8 |        11.11% |      5 |    40 |              3 |
|                9 |        10.00% |      2 |    18 |              2 |
|               10 |        10.00% |      4 |    40 |              4 |
|               12 |        10.00% |      2 |    24 |              1 |
|               13 |        10.00% |      1 |    13 |              1 |
|               14 |        10.00% |      1 |    14 |              0 |
|               23 |        10.00% |      2 |    46 |              2 |
|               24 |        10.00% |      1 |    24 |              1 |
|               26 |        10.00% |      1 |    26 |              0 |
|               30 |        10.00% |      1 |    30 |              0 |
|               35 |        10.00% |      1 |    35 |              1 |
|               38 |        10.00% |      1 |    38 |              1 |

Nineteen of 50 state allocations change. No delegation with four or fewer
seats changes because the proposed rule intentionally retains the current 20%
gate there. The first observed changes occur at five seats, where the gate falls
to 16.67%.

## Assessment

The proposal removes the sharp 20% cliff where delegation magnitude can support
broader representation while leaving small-state behavior unchanged. The
resulting chamber is substantially closer to the observed national vote shares,
all 435 seats remain conserved, and no new small-state seat transfer appears in
this snapshot.

This is a frozen counterfactual, not a prediction of the final cycle result.
Votes continue to accumulate until the election resolves.
