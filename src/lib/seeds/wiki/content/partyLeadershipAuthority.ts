export const partyLeadershipAuthorityContent = `# Party Leadership & Authority

Beyond the chair, vice chair, and treasurer elections covered in [Party Leadership](/wiki/party-leadership), four rules govern how party leadership authority actually works day to day: what happens when the chair seat is empty, how long a member must belong to a party before they can lead it, a shield that protects unmanned default parties from being ground down, and a gate on which UK regional parties can even appear on a given ballot.

## Acting chair: vice-chair inheritance

If a party's chair seat goes vacant, the party is not leaderless. When \`chairId\` is empty and a vice chair is set, the **vice chair automatically inherits chair authority**: Chair Office access, parliamentary PM proposals, coalition actions, and every other route gated on being the chair. This happens immediately, with no new election required to restore functioning leadership.

Important distinctions:

- This is an **authority** change, not a **role** change. The vice chair does not become the chair. No record is rewritten: \`chairId\` stays empty, \`viceChairId\` stays set.
- Anywhere the party's identity is displayed ("chair of this party"), the game still shows the seat as vacant. A vice chair acting as chair is never presented as the chair.
- The UI should show a "(acting)" label on the Chair Office while a vice chair is filling the role this way, so it's clear the authority is borrowed, not owned.

This covers a broad set of powers: party settings, approving join requests, purges, hero image and logo uploads, bulk org actions, priority-region selection, campaigner management, and coalition create/join/leave/disband-vote/invite decisions.

If both chair and vice chair seats are empty, no one has acting authority until a new election fills one of them.

## Leadership tenure gate

You cannot walk into a party and run for its leadership the same turn you join. A character must have been a member of the party for **24 turns** before they are eligible to run for, or vote in, that party's leadership elections. The clock resets whenever you join, switch parties, or your party absorbs into another through a merge.

A second, separate 24-turn clock applies specifically to **state** party leadership: after relocating to a new state, you must wait 24 turns before standing for (or being appointed into) that state party's leadership. This exists to stop players from relocation-hopping straight into a fresh state party's leadership seat. It runs independently of the general relocation cooldown, so even if that cooldown changes, local leadership residency stays fixed at 24 turns.

If your tenure clock hasn't started (for example, on an older character predating this system), you're treated as eligible rather than locked out.

**Exception - founding elections:** the accelerated chair race run at the very start of a new iteration waives both the standard new-character cooldown and the party-tenure gate, so brand-new characters can compete for founding leadership seats immediately.

## Unmanned-default capture shield

Default parties (the pre-seeded DEM/REP-style parties every player starts able to join, as opposed to a party a player founded) can end up with no active human chair, either because the chair seat was never filled or the sitting chair is an NPP or banned user. Without protection, a well-resourced rival could use Build Org poach and Suppression actions to grind an abandoned default party's organization and turnout to nothing, wiping out a baseline entry point that new players rely on.

The shield halves the effect of attack actions (Build Org poach, Suppression) aimed at a default party with no active human chair: an unmanned default party takes half the damage a manned party would from the same attack.

What counts as "unmanned":

- The chair seat is vacant (no \`chairId\`), or
- The chair character is an NPP (no linked player account), or
- The chair's linked account is banned

The shield only reduces what the rival's attack *removes from the target*. It never changes how much the attacker draws from the pool of unaffiliated voters, so attacking an unmanned default party is weaker, not pointless.

## UK regional party ballot gating

The UK's regional parties only contest elections in their home nation or region:

| Party | Home |
| --- | --- |
| **SNP** (Scottish National Party) | Scotland |
| **Plaid Cymru** | Wales |
| **DUP, Sinn Féin, UUP** | Northern Ireland |

None of these parties can appear on a ballot outside their home region: the SNP does not stand in England, Plaid Cymru does not stand in Scotland, and the three Northern Ireland parties do not stand on the mainland. This is enforced at the point of filing, so it doesn't matter if an NPP happens to be homed in the wrong region or a stale record exists somewhere, the game checks eligibility at filing time and blocks it.

The gate only applies to these five parties. Every other UK party, and every party in every other country, is unaffected.

## Related pages

- [Party Leadership](/wiki/party-leadership) - the chair/vice chair/treasurer election system this page builds on
- [Chamber Leadership](/wiki/chamber-leadership) - presiding officer elections (Speaker, Bundestagspräsident, etc.), which use a different eligibility engine but a similar tenure philosophy
- [Party Organization](/wiki/party-organization) - what Build Org and the org score actually do
- [Party Actions](/wiki/party-actions) - Suppression, GOTV, and other budget-based actions covered by the capture shield
- [United Kingdom](/wiki/uk-overview) - country hub with more on UK's regional party landscape
`;
