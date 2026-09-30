# Player fund order retry qualification

Scope: bounded synthetic player journeys for #2159, following #2120. This is not a world simulation or proof that every enabled financial product is ready.

## Defect and repair

A repeated successful subscribe or redeem request previously represented a second order even when the player was retrying a lost HTTP response. The baseline repeated both real routes against native sandbox Mongo and observed two financial executions. Total player plus fund cash remained conserved; the defect was duplicate intent.

The player UI now retains an operation ID and the original order while its outcome is uncertain. Concurrent submissions share that command. A new intentional order receives a fresh ID. The API claims a durable actor-scoped receipt before conversion or settlement, freezes the valuation, rejects changed payloads, and returns the original completed response on replay. Receipts do not expire into a permission to execute again.

Completion stores canonical fund transaction witnesses and original native amounts. On completed-order replay, a durable audit plan restores missing financialTxLog, enabled shadow-ledger and action-audit rows using stable IDs. This path never changes cash, fund units, supply or the redemption queue. Canonical transaction timestamps and original native/anchor amounts are retained; no new market quote or FX conversion occurs during aftercare.

## Limits

An interruption before the completion receipt on standalone Mongo remains an explicitly unknown outcome, even if some or all financial effects landed. The command is held pending for reconciliation and never blindly repeated. This change does not make underlying cross-currency conversion or forced equity liquidation independently resumable. Activity notifications retain their existing best-effort behavior. The all-products tracker row must remain unchecked on this evidence alone.

## Source and results

- Baseline route source: `65511a1316408d25ec74b375b48c6ad01eb615e7`; [two native route reproductions](./issue-2159-fund-command-baseline.json).
- Fixed native source, clean: `47af9ac9224668e220a7098d9d6d2959cd1cc192`; [ten passing native cases](./issue-2159-fund-command-native.json).
- All nine completed financial operations have exactly one financial row and their two balanced ledger entries. The three audit-stage interruptions each recover four planned records once under concurrent replay. The deliberately stopped pre-completion operation remains pending and is excluded from completed-order accounting claims.
- Browser qualification remains pending. Two preliminary attempts stopped during cold page compilation before any financial POST; no browser pass is claimed.

## Verification

- Fifteen focused tests cover UI lost-response retry and new intent, concurrent claims, actor/request isolation, never-expiring unknown outcomes, transaction-session participation and existing compensation paths.
- Native Mongo exercises real subscribe/redeem routes, accounting, fund turn and resulting read model. Only authentication, selected sandbox database and transport rate limiter are synthetic boundaries.
- Every completed native command's financial rows and enabled ledger rows must reconcile with its canonical fund transaction; each lost-ack replay writes exactly one of each planned row.

Commands use only an explicitly named `ahd_sim_fund_commands_*` database on localhost port27018:

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
