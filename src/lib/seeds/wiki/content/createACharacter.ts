export const createACharacterContent = `# Create a Character

Every account gets **one character** at a time. Character creation is fast but a few choices are durable: home state and country cost real resources to change. This page walks you through each decision.

## Account and character relationship

- **One character per account.** You can delete and re-create, but the new character starts from zero.
- **Login is separate from character.** Your account (email, password, Patreon link, admin rights) persists; the character is your in-world identity.
- **Characters are public.** Every character has a profile page at \`/character/[id]\`. Name, party, office, home state, and stats are visible to other players.
- **Banned accounts** are hidden from public listings and their characters cannot act in the world.

## Step 1: country

Pick a country. The roster below is the core Western set; the playable roster depends on the world's seed era, and a Cold War world (1953/1979) also opens the Soviet Union, East Germany, Brazil, and Nigeria:

| Country | Home region type | First offices most players target |
| --- | --- | --- |
| United States | State (50 options) | State Senate → House → Senate → Governor → President |
| United Kingdom | Region (ENG / SCO / WAL / NIR) | MP (Commons) → Party leadership → Prime Minister |
| Germany | Land (16 options) | Bundestag MdB → Party leadership → Chancellor |
| Japan | Prefecture (8 regions) | Sangiin / Shūgiin member → Party leadership → Prime Minister |
| China | Macro-region (7 options) | NPC delegate → Premier (one-party regime; selecting CN shows a CCP disclaimer) |
| Ireland | Region (8 NUTS-III) | TD (Dáil) → Party leadership → Taoiseach; Uachtarán is a separate nationwide race |

Your country scopes everything: which elections you can run in, which players you can wire money to, which party rosters you can join, and which legislature you vote in. Cross-country actions are blocked.

## Step 2: name and avatar

- **Name**: Displayed everywhere. Choose something readable; this is how other players refer to you in news, elections, and mail.
- **Avatar**: Optional image. Profiles render a default initial tile if you skip it. You can update later from settings.

There is no last-name or title system, just one free-form name field.

## Step 3: home state / region / prefecture

Your home region anchors your political career:

- **Most elections are home-scoped.** You can only run in your home region's races by default (exception: national races like President or Prime Minister).
- **Campaign costs are lowest at home** (1.0×), 1.25× for neighbours, 1.5× non-neighbour.
- **Influence decays faster than it grows.** Home campaigning builds Political Influence most efficiently.

US players pick any of the 50 states. UK players pick a **country within the UK** (England, Scotland, Wales, or Northern Ireland) which determines which Commons races are open to you. DE picks one of 16 Länder, JP picks one of 8 regions, CN picks one of 7 macro-regions, and IE picks one of 8 NUTS-III regions.

Home region can be changed later ([Relocation](/wiki/relocation)), but you lose all state Political Influence and most regional positions. Think before you pick.

## Step 4: policy positions

Two axes, each −5 to +5:

- **Economic**: −5 (strongly left, higher taxes / social spending / market regulation) to +5 (strongly right, lower taxes / minimal state / free markets)
- **Social**: −5 (strongly progressive) to +5 (strongly conservative)

These feed three systems:

1. **Primary scores.** Closer alignment to your party's official position = higher primary score.
2. **Bill voting.** When you vote on a bill your policy position shifts ±0.25 toward the bill's direction. Over many votes this moves you.
3. **Demographic appeal.** Demographic groups lean on both axes; matching their preference increases your vote share from that group.

You can (and often will) **drift over a career** because of voting. The starting value anchors your primary eligibility in the party you join, so don't pick extreme positions if you plan to run in a moderate party.

## Step 5: starting kit

On creation you receive:

| Resource | Starting value |
| --- | --- |
| Actions | 25 (one-time grant) |
| Campaign Funds | ₳250,000 |
| Cash on Hand | ₳0 |
| Political Influence | 0 |
| National Political Influence (NPI) | 0 |
| Favorability | 50 (neutral) |
| Infamy | 0 |
| Donor Base Level | 1 |
| Party Influence | 0 (you start Independent) |
| Current Office | none |

Starting currency is always your country's local unit (USD, GBP, EUR, JPY). If you relocate to a different country later, balances are **not converted**: they remain in whatever currency you had them in, but you'll typically earn and spend in the new country's currency going forward.

## Step 6: join a party

Not required at creation, but you should do it early:

- **Independents** can Campaign, Fundraise, Run Ads, Build Donor Base, Support/Attack, Barnstorm, and influence NPPs, basically everything except run for office.
- **Party members** can enter primaries, accumulate Party Influence, earn bonus actions from the party pool, and stand for party leadership positions (chair, vice chair, treasurer).
- **Closeness to platform** matters. Your policy-axis distance from the party's official position amplifies how efficiently your Party Influence converts to bonus actions.
- **Switching parties** is allowed but incurs penalties: Favorability and Political Influence both take hits.

Browse parties from the country's Parties page before committing. Custom player-founded parties exist alongside the major seeded parties.

## What happens after creation

- You land on your profile page. A setup banner walks you through: reading the Getting Started wiki page, joining a party, and taking your first action.
- Your character appears in the home-state player list and politicians directory.
- A "Character Created" achievement fires (**Founding Father** badge if you joined during alpha).
- The turn processor picks you up on the next hour boundary for passive effects (NPI accrual, infamy decay, favorability decay if above 60, etc.).

## Common new-player mistakes

- **Picking a low-population home state** hoping to dominate. Small states have lower fund-generation donor bonuses and fewer electoral stakes. Medium/large states give you more to work with.
- **Setting policy positions at −5/−5 or +5/+5**. Extreme positions cap your primary viability in moderate parties and limit your demographic appeal ceiling.
- **Skipping the party for the first 48 hours**. You're leaving bonus actions and primary access on the table.
- **Spending the 25 starting actions on Fundraise**. Fundraise yields the most when your donor base is higher, so open with Campaign and one Build Donor Network first.

## Related

- [Getting Started](/wiki/getting-started): Overall first-player guide.
- [Relocation](/wiki/relocation): Changing home state / country / CEO rules.
- [Stats & Actions](/wiki/stats-actions): Full reference of every stat.
- [Parties](/wiki/parties): How parties work and what leadership offers.
- [First Campaign Walkthrough](/wiki/first-campaign-walkthrough): Step-by-step new-player playthrough.
`;
