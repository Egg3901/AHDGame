export const coalitionFormationContent = `# Coalition Formation

Coalitions are created and managed by national party chairs. This page covers the full lifecycle: creating, inviting parties, joining, leaving, and disbanding.

## Creating a coalition

Only a **national party chair** can create a coalition.

Required fields:
- **Name**: 3-60 characters, unique per country
- **Abbreviation**: 2-10 characters
- **Hex color**: for display on the coalition card and logo

On creation, your party automatically becomes the first member and the **coalition chair party**. As the chair, your character holds the coalition chairmanship.

From the Parties page, use the country selector, open the Coalitions tab, then click "Create Coalition." Non-chairs see the button grayed out with a tooltip explaining the restriction.

## Inviting parties

As coalition chair, you can invite other parties by their party ID from the **Chair's Office** tab on the coalition detail page.

Invite flow:
1. Chair sends invite to target party
2. Target party's national chair sees an invite banner on the coalition page
3. Chair accepts and the party joins, or chair declines and the invite is removed

## Joining a coalition

Any national party chair can request to join an existing coalition without waiting for an invite.

Join request flow:
1. National chair submits a join request from the coalition page
2. Coalition chair sees the pending request in their Chair's Office tab
3. Coalition chair accepts and the party joins, or declines and the request is removed
4. Requesting chair can cancel their own pending request at any time

## Leaving and kicking

- **Leaving voluntarily**: Any member party's national chair can leave using the "Leave Coalition" button
- **Kicking**: The coalition chair can kick any member party; the kicked party's chair receives a notification

If the **coalition chair party** leaves voluntarily:
- If other members remain, the **most senior member by join date** automatically becomes the new chair party
- If no members remain, the coalition is deleted

## Chair mechanics

Every coalition tracks its chair party and the specific character within that party who serves as national chair. Both update automatically as leadership changes.

**Chair transfer**: The coalition chair can voluntarily transfer chairmanship to any member party's national chair at any time from the Chair's Office tab.

**Succession**: If the chair party is deleted by the empty-party cleanup process, the next most senior member inherits the chair automatically.

## Disband votes

Only the **coalition chair** can initiate a **disband vote**, from the Chair's Office. Other member chairs cannot start one; they can only vote once it's open.

Rules:
- Duration: **24 hours** from initiation
- Voting: each member party's national chair votes yes or no; votes can be changed before expiry
- Threshold: majority required, more than half the member parties voting yes
- Only **one disband vote** can be active per coalition at a time

If the vote passes: the coalition is deleted, all member parties lose their coalition affiliation, and all chairs receive a notification.

If the vote fails: the vote is cleared and the coalition continues unchanged.

Disband votes are resolved during turn processing, not instantly. Votes expire at the next turn that runs after the 24-hour window.

## Party deletion cascade

When a party is deleted by the empty-party cleanup (no members, no seats):
1. The party is removed from any coalition's members array
2. If the deleted party was the coalition chair, the next most senior member becomes the new chair
3. If no members remain after removal, the coalition is deleted entirely

## Related

- [Coalitions](/wiki/coalitions): What coalitions are and their gameplay effects.
- [Party Leadership](/wiki/party-leadership): National chair role and coalition management.
- [Political Parties](/wiki/political-parties): How parties relate to coalitions.
`;
