# Registration without presence repair

Manual incident repair, not a deploy/startup migration. Defaults to a read-only
snapshot and has no writes, including no audit or migration marker writes, in
dry-run mode. Deploy the registration-drive presence fix first.

```powershell
npx tsx scripts/migrations/heal-registration-without-presence.ts --live --dry-run --env-file="E:/path/to/.env.local"
```

Use `--direct-connection` only when needed for a single MongoDB endpoint behind a
proxy. Omit `--live` for `MONGODB_URI`; `--live` selects `MONGODB_URI_LIVE`.
Connection strings are never printed. Do not commit live output.

The plan covers every country and uses current players, active NPPs and regional
officeholders. Org and cached presence flags do not establish presence. It zeros
an absent party's Reg and credits exactly that amount to its region's Independent
pool, preserving Org, Unregistered and the regional total. Country IDs are scoped;
ambiguous legacy rosters abort the operation. Invalid or missing pools and totals
outside 100 plus/minus 0.000001 are reported and block the entire apply.

Review every proposed transfer, including absent parties with positive Org. Such
parties may still receive the separate existing passive Org-to-Reg drift; this
repair is a one-time cleanup, not a change to that mechanic. The code fix stops
paid registration drives in absent regions, including those with zero Org.

Apply only with explicit admin approval, full maintenance and paused turns. Allow
in-flight player requests to finish and avoid concurrent admin edits before apply.
The tool never changes these operating modes itself. Supply the reviewed current
turn, not the turn from an old dry-run:

```powershell
npx tsx scripts/migrations/heal-registration-without-presence.ts --live --apply --expected-turn=48 --env-file="E:/path/to/.env.local"
```

Apply recalculates the plan inside a snapshot transaction, validates the clock and
maintenance mode, guards the preimages, writes all changes atomically and checks
that no eligible transfers remain. Exact registration and pool preimages are saved
in `adminLogs` (`party_org_updated`, repair `registration-without-presence`). Paired
`orgRegLedger` entries record every debit/credit. An immediate rerun is a no-op.

Recovery should use those preimages only in a maintenance window with verification
that no subsequent registration changes have occurred. Never overwrite newer
player activity with an old snapshot. Resume normal operation only after verifying
the resulting regional totals and releasing maintenance deliberately.
