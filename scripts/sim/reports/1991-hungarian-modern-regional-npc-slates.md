# Hungarian regional NPC slate qualification

Issue: #2488. Runtime source: `2ce4c6079722e063ab559cbc23a413296cd77928`. Executed 2026-10-03.

An NPC financial owner may back distinct regional individual slates. Campaign re-entry coalesces within the owner's region, retaining each regional vote baseline. The individual Assembly builder accepts one NPC actor per owner and region, without permitting a player owner to file multiple regional identities. Candidate IDs and physical person IDs stay distinct, and shared owners retain their accounts.

All16 portable campaign-alias and modern Assembly cases pass. The14-case isolated Mongo suite passes through real primary dispatch, whole-country certification, concurrent handover, national-list replacement and constituency by-election. Its new case reuses the same financial owner in two regions. Both regional delegations install, the shared owner's seat counter and office mirror equal its actual physical mandates both after handover and after replacement/by-election, all12 original financial profiles remain, and every original private balance is unchanged. An unused profile retains its original empty office and absent zero-seat counter; qualification compares those optional values as zero.

Scope-specific TypeScript, changed-file lint and formatting pass. Architecture has zero blocking findings and66 existing warnings. No new Mongo query is introduced by the portable correction. The original six-region binding remains10 commands,6,917 command bytes and3,453 reply bytes. Hosted checks remain required before integration.

Separate district/list campaigns, joint and linked slates, minority nominations, contradictory positive legacy player re-entry and fresh whole-world horizons remain parent criteria. This bounded test does not establish development or production delivery.
