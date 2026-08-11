import {
  INTERNATIONAL_ORGANIZATION_ORDER,
  INTERNATIONAL_ORGANIZATIONS,
} from "@/lib/constants/internationalOrganizations";

const builtInOrgs = INTERNATIONAL_ORGANIZATION_ORDER.map((id) => INTERNATIONAL_ORGANIZATIONS[id]);
const builtInCount = builtInOrgs.length;
const builtInListProse = builtInOrgs.map((o) => o.shortName).join(", ");

const builtInTableRows = builtInOrgs
  .map((o) => `| **${o.shortName}** (${o.name}) | ${o.description} |`)
  .join("\n");

export const internationalOrganizationsContent = `# International Organizations

International Organizations are multilateral bodies that countries can join, lead, and use to coordinate foreign policy, pass bloc-level legislation, and establish free trade agreements. The system ships with ${builtInCount} built-in organizations (${builtInListProse}) and also allows players to create custom organizations.

## Built-in organizations

| Organization | Description |
| --- | --- |
${builtInTableRows}

These ${builtInCount} are defined in the catalogue; era founding and dissolution years decide which exist in a given world. Players can also create custom organizations.

## Organization structure

Every organization, built-in or custom, has the following components:

### Founding members

Each org is created with a list of founding member countries that defines the initial membership. Additional countries can join later through the membership proposal process (see below).

### Leadership office

Each org has a **leadership office** with:

- A **title** (e.g., Secretary-General, Secretary General, President of the Council)
- A **termTurns** of **96 turns** (approximately 2 game years)

Leadership elections are held when the term expires, and the office confers authority over the org's agenda and legislation.

### Charter

Each org has a **charter**: a text document describing its purpose, rules, and governance principles. The charter is set at creation and can be amended through org legislation.

## Membership proposals

New countries join an org through a **membership proposal**, which is voted on by existing members for **24 turns**. If the proposal passes within that window, the applicant becomes a member. If it fails or expires, the country is not admitted.

## Leadership elections

When a leadership term (96 turns) expires, the org holds a **leadership election**. Eligible candidates compete for the leadership office, and the winner serves the next full term. Holding leadership of a major org like the EU or NATO is a significant source of political influence on the international stage.

## Organization legislation

International organizations can pass legislation that binds their members. Key legislation types include:

- **Withdrawal bills**: a member-state's exit from the organization
- **FTA legislation**: establishing a free trade agreement between members (see [International Trade](/wiki/trade-system))

Org legislation is voted on by members, typically over the same 24-turn voting window used for membership proposals.

## Custom organizations

Players can **create their own international organizations** with arbitrary parameters:

- **A player-chosen name**: the org is identified by a unique short name
- **A player-created flag**: marks the org as player-created (as opposed to built-in)
- Player-defined founding members, leadership office, and charter

Custom orgs function identically to built-in ones for membership, leadership, and legislation purposes. The primary difference is provenance: they did not exist at game start.

## Organization pages

Each organization has a dedicated page at the route:

\`\`\`
/international/[orgId]
\`\`\`

This page displays the org's membership, current leadership, active legislation, charter, and proposal history. Both built-in and custom orgs are accessible this way.

## Strategic notes

- **Joining an org grants bloc benefits.** Countries that share an org membership receive a trade affinity bonus (see [International Trade](/wiki/trade-system)).
- **Leading an org amplifies your voice.** The leadership office gives you agenda-setting power and political influence.
- **FTAs are the most impactful org legislation.** A free trade agreement between two members eliminates bilateral tariffs and boosts trade affinity, a major economic lever.
- **Custom orgs are flexible.** You can create a bloc tailored to your diplomatic strategy, inviting only aligned countries.

## Related systems

- **[International Trade](/wiki/trade-system)**: how org membership and FTAs affect trade affinity
- **[Tariffs](/wiki/tariffs)**: how FTAs override bilateral tariffs
- **[Foreign Policy](/wiki/government-approval)**: international standing and its domestic effects
`;
