export const createACharacterContent = `# Create a Character

One character per account. A few clicks are expensive to undo. Do them in this order.

## Open creation

1. Log in with an account that has no living character.
2. You are sent to **Create Character** (\`/create-character\`).
3. If you already have a character, you cannot open this flow until you retire or delete it.

## Click path

### 1. Country

Pick the country you actually want to play. It scopes elections, parties, legislature, and who you can wire. Relocation later wipes party, national influence, and national office.

| Country | Home pick | First office most people target |
| --- | --- | --- |
| United States | State (50) | State Senate, then House |
| United Kingdom | ENG / SCO / WAL / NIR | MP (Commons) |
| Germany | Land (16) | Bundestag MdB |
| Japan | Region (8) | Shūgiin or Sangiin |
| China | Macro-region (7) | NPC delegate (one-party; disclaimer on pick) |
| Ireland | Region (8) | TD (Dáil) |

Confirm. You cannot campaign across countries.

### 2. Name and avatar

Type a readable name. Optional avatar; skip it if you want the default tile. You can change the image later in Settings. There is no separate last-name field.

### 3. Home state / region

This is where you canvass cheapest and where most local races live. National races (President, PM) are the exception.

US: any of 50 states. UK: England, Scotland, Wales, or Northern Ireland. DE: one Land. JP: one of 8 regions. CN: one of 7. IE: one of 8.

You can [relocate](/wiki/relocation) later. You lose state Political Influence when you do. Pick once, carefully.

### 4. Policy positions

Two sliders, each -5 to +5:

- **Economic:** -5 left / +5 right
- **Social:** -5 progressive / +5 conservative

These feed primaries (distance to your party), bill voting (each vote nudges you ±0.25), and demographic appeal.

Do not slam both to -5 or +5 unless that party is actually extreme. Moderate parties punish extremes in the primary.

### 5. Confirm and take the kit

On submit you receive:

| Resource | Starting value |
| --- | --- |
| Actions | 25 (one-time) |
| Campaign Funds | ₳250,000 |
| Cash on Hand | ₳0 |
| Political Influence | 0 |
| NPI | 0 |
| Favorability | 50 |
| Infamy | 0 |
| Donor Base | 1 |
| Party | Independent |
| Office | none |

You land on your profile. A setup banner asks you to read Getting Started, join a party, and take a first action. Your name appears in the home-state player list.

## What to click immediately after

1. Open **Parties**. Join one close to your sliders.
2. Open **Dashboard**. Spend Campaign actions.
3. Continue on [Getting Started](/wiki/getting-started).

## Your first week

- [ ] Country and home region chosen on purpose, not at random.
- [ ] Policy sliders within a few points of the party you joined.
- [ ] Party joined the same day you created.
- [ ] Starting actions not dumped into Fundraise before Donor Level 2.
- [ ] First race identified on **Elections** (poll before declare).

## Common misses

- Skipping the party for two days: you leave bonus actions and primaries on the table.
- Tiny home state for "easy wins": lower donor income and fewer stakes.
- Fundraise as the first action: it pays once the donor base is higher.

## Related

- [Getting Started](/wiki/getting-started)
- [Relocation](/wiki/relocation)
- [Parties](/wiki/political-parties)
- [First Campaign Walkthrough](/wiki/first-campaign-walkthrough)
`;
