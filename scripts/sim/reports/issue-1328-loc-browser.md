# LOC and treasury browser qualification

Issue #1328. Runtime source: `f4857dec06a1bcd8dd48d8e44540ad6290ba5962`, integrated through PR #2650 as `a8de037f9cc5adfbd97fda44e58865583276ef05`. The pinned source includes treasury PR #2652. All applicable source CI checks passed. The [machine-readable result](issue-1328-loc-browser.json) records the completed browser run, not inferred route-test coverage.

## Scope and configuration

The runner copied retained synthetic banking context into a fresh isolated Mongo database. It used one loopback development app, the real authentication middleware, synthetic player identity, actual visible forms, production API routes, Settlement Journal and one actual LOC servicing turn. The retained source database hash was unchanged after completion. Background development processing and external integrations were disabled; the owned browser and app stopped successfully.

This is bounded player-journey evidence. It does not activate private banking, retire legacy savings or qualify the remaining live observation and global stress gates. Existing [native LOC qualification](issue-1328-loc-settlement.md) separately covers fifteen monetary parity and recovery cases.

## Actual LOC page

Opened `/centralbank/usd?tab=loc` as the synthetic player and opened its USD account through the form. Initial wallet was $114,422,553.37, with no LOC debt or LOC journals.

| Visible action                               | USD principal | Wallet delta from initial | LOC journals | Verified outcome                                                      |
| -------------------------------------------- | ------------: | ------------------------: | -----------: | --------------------------------------------------------------------- |
| Borrow $1,000, lose successful HTTP response |      1,000.00 |                 +1,000.00 |            1 | The committed operation survived the deliberately aborted response.   |
| Retry the same amount                        |      1,000.00 |                 +1,000.00 |            1 | Same command identity; exact wallet, debt and ledger state unchanged. |
| Borrow a new $500                            |      1,500.00 |                 +1,500.00 |            2 | A different command identity permitted a legitimate new draw.         |
| Repay $1,000                                 |        500.00 |                   +500.00 |            3 | Real repayment route reduced debt and wallet together.                |
| Actual LOC servicing, turn 569               |        498.65 |                   +497.97 |            4 | Wallet paid $2.03: $1.35 principal and $0.68 interest.                |

Reloaded the actual page and queried its authenticated read model. Its principal was exactly $498.65, matching persistence. There were no unhandled page errors. Deliberately excluded nonessential background requests can produce caught console messages; these are not financial command failures.

## Actual treasury panel

Explicitly assigned the same synthetic actor to the US treasury-minister office. No treasury or bank cash changed during setup. Used the actual minister office, `Flagship` tab, `Debt & FX`, and `FX Reserve Transfer` form. The existing route permits a negative treasury position subject to its revenue and debt-ceiling rules; the runner preserved that policy and the retained negative cash position.

Submitted $100, deliberately lost the successful response, then retried through the visible form with the same operation identity.

| Position              |                Before | After the first commit and after retry |
| --------------------- | --------------------: | -------------------------------------: |
| Treasury cash         | -2,318,224,476,419.00 |                  -2,318,224,476,519.00 |
| Central-bank reserves | 50,411,504,042.566765 |                  50,411,504,142.566765 |

The retry left the complete measured snapshot unchanged. Exactly one transfer history entry was added. Annual spending was unchanged. The reserve starting value is measured after the LOC servicing step, so it includes that step's $0.68 interest credit.

## Reproduction

Use a clean checkout at the source pin, the retained synthetic banking fixture produced by the existing banking journey, and a fresh target name. The runner validates the sandbox endpoint, synthetic identity and empty target. It refuses to reuse a populated target.

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ \
  npx tsx --tsconfig tsconfig.json scripts/sim/lineOfCreditBrowserJourney.ts \
  --source=ahd_sim_retained_banking_fixture \
  --target=ahd_sim_loc_browser_qualification \
  --treasury=true --out=loc-browser-qualification.json
```

The source fixture requires its existing synthetic player and cash, registered US context, treasury budget and central bank. The treasury role is explicit test setup, not a claimed historical appointment. The runner records source provenance and checkpoints after monetary actions, allowing a failed later step to be diagnosed without repeating accepted financial commands. Cold route compilation accounted for most elapsed time; the run did not use a full world simulation or production database.
