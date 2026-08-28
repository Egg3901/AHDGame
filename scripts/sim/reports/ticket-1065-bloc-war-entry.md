# Ticket 1065 bloc war-entry report

Run against the live turn 459 world on 2026-08-28 with:

```text
npx tsx scripts/sim/blocWarEntryPolicy2026-08-28.ts
```

## Outcome

- The active Warsaw Pact call is collective defense for every modeled member other than East Germany, which is already a principal belligerent. All take the immediate path. Bulgaria, Czechoslovakia, Hungary, Poland, and Romania had unanimous but still-open bills that the reconciliation will enact immediately.
- West Germany is a principal belligerent because the conflict names both Germanies as host entities. It takes the immediate path on NATO's side.
- Every other NATO member is entering an offensive coalition and remains on the national-vote path.
- Bloc relations move offensive national support without erasing domestic politics. Among the modeled countries with existing bills, the pressure snapshots are Brazil +8.9, France +9.3, Greece +11.3, Ireland +11.0, Italy +9.5, Japan +7.4, Sweden +5.9, Turkey +9.2, and the United Kingdom +20.0. The force is capped at plus or minus 40.
- The live world had 14 active autonomous foreign-policy bills and 22 active routine domestic bills. Ticket 1065 removes the foreign-policy bills from the routine sponsorship cap and cooldown, so ordinary legislative business continues during the war-entry window.

## Existing national tallies

| Country        | Stakes                |  Pressure | Lower for-against-abstain | Upper for-against-abstain |
| -------------- | --------------------- | --------: | ------------------------- | ------------------------- |
| Brazil         | offensive coalition   |      +8.9 | 0-5-0                     | 0-46-35                   |
| West Germany   | principal belligerent | immediate | 75-73-103                 | none                      |
| France         | offensive coalition   |      +9.3 | 139-135-353               | 315-215-177               |
| Greece         | offensive coalition   |     +11.3 | 120-0-180                 | none                      |
| Ireland        | offensive coalition   |     +11.0 | 71-28-27                  | none                      |
| Italy          | offensive coalition   |      +9.5 | 153-127-310               | 169-91-20                 |
| Japan          | offensive coalition   |      +7.4 | 187-187-91                | 99-79-61                  |
| Sweden         | offensive coalition   |      +5.9 | 53-0-177                  | none                      |
| Turkey         | offensive coalition   |      +9.2 | 263-164-0                 | none                      |
| United Kingdom | offensive coalition   |     +20.0 | 223-187-104               | none                      |

The live ballots already cast are not rewritten. Reconciliation backfills pressure onto the active bills so remaining NPP voters respond to bloc relations and the stakes of fighting the Soviet coalition. Current outcomes remain genuinely uncertain: Brazil is rejecting entry, Japan is tied in the lower chamber, and several other governments are narrow.

## Force balance

This policy change retains the previously released Warsaw Pact mobilization balance: a 35 percent strongest-first reserve commitment against NATO's default 20 percent commitment. The existing `blocEntryBalance2026-08-28.ts` combat report remains the force-balance authority for the same live conflict.
