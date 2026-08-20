export const coalitionsContent = `# Coalitions

Coalitions are cross-party alliances within a single country. They let parties pool their political identity and, in the US specifically, aggregate their legislative seats into bloc math for chamber leadership.

## What a coalition does

In the **US**, coalitions have a direct mechanical effect on chamber leadership:

- Parties in the same coalition have their seats combined into a **bloc**
- The largest bloc is the **majority bloc**; the second-largest is the **minority bloc**
- House and Senate Majority Leader (and Whip) are narrower: only the single national party with the most seats in that chamber may declare or vote
- Minority-side leadership (Leader and Whip) remains open to non-majority parties outside the majority bloc
- Speaker of the House, Senate President Pro Tempore, and the DE Bundestagspräsident are open to any seated chamber member: bloc and party affiliation do not gate candidacy or voting for these presiding-officer roles

Outside the US, coalitions are **organizational and signaling only**. Parliamentary countries (UK, DE, JP, IE) use their own government-formation systems and do not consult coalition membership when forming governments. There is no country CA in the live roster (CA is California).

## Coalition structure

Every coalition has:
- A **name** (3-60 characters) and **abbreviation** (2-10 characters)
- A **hex color** for display
- A **chair party** - the party that manages the coalition
- A **chair character** - the national chair of the chair party
- An ordered **members list** tracking each party's join date

Coalitions are scoped to a country - a US coalition cannot include UK parties.

## Viewing coalitions

On the \`/parties\` page, there is a **Parties / Coalitions** tab switcher. The Coalitions tab shows all coalitions for the selected country as a card grid. Coalition detail pages are at \`/parties/coalition/[id]?country=X\`.

Each coalition detail page shows:

| Tab | Contents |
| --- | --- |
| Overview | Averaged policy positions, leadership, disband vote panel |
| Parties | Member party list with logos and join dates |
| Chair's Office | Invite management, join requests, kick, transfer, disband |
| Admin | Admin-only party/chair management |

## Membership size effects

The larger your coalition, the stronger your bloc - but also the more parties that need to agree on how to use it. A coalition with 5 parties has 5 chairs who can initiate or vote on disband, meaning defections require broader consensus.

## Coalition vs. party

Coalitions and parties are distinct. A character belongs to a **party**, not directly to a coalition. The coalition is a relationship between parties at the national chair level. Individual members of a party inherit the coalition's bloc status, which affects Minority Leader/Whip exclusion and several other coalition-aware UI signals. But they are not "members of the coalition"; they are members of a member party.

## Related

- [Coalition Formation](/wiki/coalition-formation) - How to create, invite, join, and disband.
- [Party Leadership](/wiki/party-leadership) - National chair role required to manage coalitions.
- [Political Parties](/wiki/political-parties) - How parties relate to coalitions.
`;
