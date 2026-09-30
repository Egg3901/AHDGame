# Player fund order retry qualification

Scope: bounded synthetic player journeys for #2159, following #2120. This is not a world simulation or proof that every enabled financial product is ready.

## Defect and repair

A repeated successful subscribe or redeem request previously represented a second order even when the player was retrying a lost HTTP response. The baseline repeated both real routes against native sandbox Mongo and observed two financial executions. Total player plus fund cash remained conserved; the defect was duplicate intent.

The player UI now retains an operation ID and the original order while its outcome is uncertain. Concurrent submissions share that command. A new intentional order receives a fresh ID. The API claims a durable actor-scoped receipt before conversion or settlement, freezes the valuation, rejects changed payloads, and returns the original completed response on replay. Receipts do not expire into a permission to execute again.

Completion stores canonical fund transaction witnesses and original native amounts. On completed-order replay, a durable audit plan restores missing financialTxLog, enabled shadow-ledger and action-audit rows using stable IDs. This path never changes cash, fund units, supply or the redemption queue. Canonical transaction timestamps and original native/anchor amounts are retained; no new market quote or FX conversion occurs during aftercare.

## Browser harness recovery

The preliminary browser attempts were not counted as passes. Cold page and command compilation exceeded transport deadlines. After a timed-out Subscribe request, a read-only check confirmed zero new command receipts and unchanged cash; the completed command module returned 405 to a read-only GET. The final attempt reused that explicitly owned app, warmed both command modules with non-mutating GETs, then exercised the actual UI. The app and browser stopped after success. No uncertain financial command was blindly replayed.

## Limits

An interruption before the completion receipt on standalone Mongo remains an explicitly unknown outcome, even if some or all financial effects landed. The command is held pending for reconciliation and never blindly repeated. This change does not make underlying cross-currency conversion or forced equity liquidation independently resumable. Activity notifications retain their existing best-effort behavior. The all-products tracker row must remain unchecked on this evidence alone.

## Source and results

- Baseline route source: `65511a1316408d25ec74b375b48c6ad01eb615e7`; [two native route reproductions](./issue-2159-fund-command-baseline.json).
- Fixed native source, clean: `47af9ac9224668e220a7098d9d6d2959cd1cc192`; [ten passing native cases](./issue-2159-fund-command-native.json).
- All nine completed financial operations have exactly one financial row and their two balanced ledger entries. The three audit-stage interruptions each recover four planned records once under concurrent replay. The deliberately stopped pre-completion operation remains pending and is excluded from completed-order accounting claims.
- [Actual browser qualification](./issue-2159-fund-command-browser.json) passed at clean harness `ee73216172a14e83d335ef940e9a578ee43b1850`. The reused loopback server started at `2d4574de2487b06d8ea57a85ec9ba82dc5c0d262`; the only later source change was browser harness lifecycle/warming. Runtime remained identical to the native 47af proof.
- Browser Subscribe: wallet 9,960 → 9,950 USD, fund cash 140 → 150, units 14 → 15. Redeem returned those balances to 9,960/140 and units 14. Each successful response was deliberately dropped, and each UI retry sent the identical operation ID without another movement. Both read models matched. Each browser command has one financial row, two balanced ledger entries and its action-audit row.
- Actual fund turn 3 processed one fund and one NAV update, no errors, with the post-redemption cash and unit totals unchanged.
- The final source delta after these replays only formats the command helper and registers its world-bound receipt collection in the seed/reset manifest. No replayed financial behavior changed.

## Verification

- Fifteen focused tests cover UI lost-response retry and new intent, concurrent claims, actor/request isolation, never-expiring unknown outcomes, transaction-session participation and existing compensation paths.
- Native Mongo exercises real subscribe/redeem routes, accounting, fund turn and resulting read model. Only authentication, selected sandbox database and transport rate limiter are synthetic boundaries.
- Every completed native command's financial rows and enabled ledger rows must reconcile with its canonical fund transaction; each lost-ack replay writes exactly one of each planned row.

Commands use only an explicitly named `ahd_sim_fund_commands_*` database on localhost port 27018:

```sh
node scripts/sim/fundPlayerCommandReplay.mjs \
  --target=ahd_sim_fund_commands_review \
  --out=/path/to/native.json
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ \
  npx tsx scripts/sim/fundPlayerBrowserJourney.ts \
  --target=ahd_sim_fund_commands_review \
  --out=/path/to/browser.json
```

The browser app is loopback-only with development background jobs disabled. No production activation, live database changes or full world run are involved.
