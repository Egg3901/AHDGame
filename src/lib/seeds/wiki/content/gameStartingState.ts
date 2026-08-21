export const gameStartingStateContent = `# Game Starting State

Every country in A House Divided starts from a fixed seed: protected default parties, empty legislatures, generated NPPs, starting treasuries, national macro numbers, sovereign debt, regional sector specialties, resource capacity, and unowned sector markets. This page is the audit view of that opening board.

Several start-date presets are available when an admin resets the world: **1953**, **1979**, **1991**, and **2019**. The 1953 and 1979 Cold War openings add the Soviet Union, East Germany, and the wider Eastern and Western bloc; the sections below focus on the **1991** and **2019** modern openings. Coverage is layered rather than all-or-nothing: core playable countries have full political rosters, while additional countries such as Nigeria and the wider macro board can carry regions, budgets, metrics, currencies, trade, or historical data without exposing every player surface.

The 1991 preset seeds historical seat composition (US 102nd Congress, UK post-1992 election, JP post-1990 election, DE 12th Bundestag, CN 7th NPC, BR 49th Congress, IE 27th Dáil) plus era-gated party rosters (UUP / PDS / JSP / DSP / PMDB / PFL / PDT / PDS-BR / PTB / PRN / PSB / PCdoB / WP / PD restored; AfD / Linke / Reform UK / CDP / Ishin / DPFP / Sinn Féin (IE) / Green Party (IE) / União Brasil omitted). Election cycle scheduling anchors to real 1992-1994 cycles across US House (1992), US President (1992), UK Commons (1992), JP Shugiin (1993), JP Sangiin Class A (1992), DE Bundestag (1994), CN NPC (1993), BR Câmara (1994), and IE Dáil (1992). Registration / org footprints reflect 1988-1992 vote shares; sector weights reflect the 1990 manufacturing-heavy / pre-tech-cluster economic mix; state metrics are era-shifted (no broadband, no social media, US 1991 crime peak, US 1990-91 recession unemployment uplift, lower median age, lower life expectancy). DC is seeded for both presets.

The 1991 long-run economic layer (regional populations, GDPs, fiscal-year budgets, debt levels, credit ratings, tax bases) uses 1991-era values where authored. National budgets use 1991 fiscal years (US FY1991, UK FY1991, JP FY1991, DE FY1991, IE FY1991, BR FY1991-real-equivalent, CN FY1991). Sources and approximations are documented in the seed files.

**Ideology scale reminder:** economic and social positions each run from -5 to +5.
- Economic: -5 is far-left; +5 is far-right.
- Social: -5 is progressive; +5 is traditional/conservative.

## Starting dashboard

\`\`\`starting-state-dashboard
\`\`\`

## Economy and sector markets

Each country seeds an **unowned sector market** for all 17 sector types across every region. Corporations acquire slices of this pool; the remainder stays unowned until other players move in. Regional sector specialties add starting margin bonuses on top of that market shape: primary specialties grant +10 percentage points and secondary specialties grant +5 percentage points. Extractable resources use separate per-region capacity ceilings, shown in the dashboard above and mapped in more detail below.

Sector market sizes are seeded proportionally to real-world GDP composition rather than split evenly. A region's seeded market for any given sector is:

> **seed = region GDP x exchange rate x 450 x sector weight**

where *sector weight* is the fraction of that region's economy attributed to the sector. The scale factor of 450 produces a starting US stock market roughly four to five times larger than the old equal-split baseline.

Examples:
- California heavily favors technology and lightly seeds extraction.
- West Virginia heavily favors extraction and lightly seeds technology.
- New York is strongest in financial services.
- Tokyo/Kanto leans toward finance more than automobiles.
- Bavaria has a strong automobiles seed.
- China's northwest opens around energy and extraction, while eastern and southern regions lean technology and manufacturing.
- Dublin leans technology and finance; Ireland's southwest leans chemical industries and technology.
- Brazil splits sharply: Norte favors extraction, Centro-Oeste favors agriculture, and Sudeste favors finance and manufacturing.

The dashboard's **Specialties** section is the canonical opening audit for the countries with authored regional bonus coverage in the selected preset. It lists each region's primary +10pp and secondary +5pp sector margin bonuses and shows the local sector seed share behind both choices.

Use the map below to inspect sector weight by region and country.

\`\`\`sector-seed-map
\`\`\`

## Cross-country notes

**Default parties cannot be deleted.** They exist in every game world and survive regardless of treasury or membership. Player-founded parties can be dissolved if they lose all members.

**Dynamic NPP generation** uses weighted name generators seeded per country. Generated NPPs start with ideology positions drawn from their party range and blended with their home region's lean. Favorability, loyalty, and stubbornness are randomized within bounds.

**Starting treasuries do not regenerate passively.** Parties grow their funds through player-paid dues, tax rates set by leadership, and event outcomes. Low-treasury parties can still compete if players fund them aggressively.

**No government is formed at turn 0.** Parliamentary countries begin with pending government formation. The first coalition or majority must be assembled through in-game votes once NPPs and players are in place.

## Related

- [Create a Character](/wiki/create-a-character) - Country selection and what it changes for your character.
- [Political Parties](/wiki/political-parties) - How parties work, party creation costs, and leadership structures.
- [Party Ideology](/wiki/party-ideology) - How economic and social positions affect primaries and NPP alignment.
- [NPP Behavior](/wiki/npp-behavior) - How generated NPPs vote, campaign, and interact with players.
- [Coalition Formation](/wiki/coalition-formation) - How parliamentary governments are assembled from the starting state.
`;
