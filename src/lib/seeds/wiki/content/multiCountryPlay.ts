export const multiCountryPlayContent = `# Multi-Country Play

A House Divided currently runs six active countries: the United States, United Kingdom, Germany, Japan, China, and Ireland. Each has its own political system, legislature, election rules, and currency. This page covers how character scoping works, how to manage context across countries, and how economic systems cross borders.

## Character country scoping

Every character is locked to a single country when you create them. This determines:

- Which country's elections you can enter
- Which legislature you can vote in
- Which party registry you join
- Which regional bills you can propose and vote on
- Which country's currency your government income is paid in

**You can relocate your character to a different country.** Relocation resets your national influence and party affiliation (you rejoin as independent in the new country), so it is a real reset, not a free swap. If you want to keep a presence in two countries at once, a second character is still the simpler option, but switching your existing character is possible.

However, economic investments (corporations, bonds, forex positions) cross country lines freely.

## Country political systems at a glance

| Country | System | Legislature | Executive | Election method |
|---|---|---|---|---|
| United States | Presidential | Congress (Senate + House) | President (directly elected) | FPTP, staggered Senate classes |
| United Kingdom | Parliamentary | Parliament (Commons + Lords) | Prime Minister (confidence of Commons) | FPTP, snap elections allowed |
| Germany | Parliamentary | Bundestag (+ Bundesrat) | Chancellor (confidence of Bundestag) | Mixed-member proportional (AMS) |
| Japan | Parliamentary | Kokkai (Shūgiin + Sangiin) | Prime Minister (confidence of Shūgiin) | FPTP, snap elections allowed |
| China | One-party state | National People's Congress (delegate-elected) | Premier (elected by NPC delegates) | One-party elections; approved/banned regime tiers; regime can collapse |
| Ireland | Parliamentary | Oireachtas (Dáil + Seanad) | Taoiseach (confidence of Dáil); Uachtarán (directly elected, ceremonial head of state) | Hare-quota multi-seat allocation; snap elections allowed |

Parliamentary systems (UK, DE, JP, IE) form governments through legislative confidence rather than direct election. No one runs "for Prime Minister" / "Taoiseach" / "Chancellor" directly - you win a seat, your party wins a majority (or coalition), and the party leader is appointed. Ireland also elects a separate ceremonial head of state, the Uachtarán, on a 7-year nationwide ballot. The 1.0 simulation resolves that race from first-preference totals; ranked transfer fidelity is planned as a later electoral-system upgrade.

China is unique as the only one-party state: see [One-Party States](/wiki/one-party-states) for how regime tiers, ruling-party confidence, liberalization reforms, and regime collapse work.

## Playing in parliamentary countries

In the UK, Germany, Japan, and Ireland, the path to executive power is:

1. Win a Commons / Bundestag / Shūgiin / Dáil seat in your home region.
2. Your party accumulates seats through elections.
3. If your party reaches a majority (UK: 326, DE: 316, JP: 233, IE: 81 seats) or can form a confidence coalition, the party leader is appointed PM / Chancellor / Taoiseach.
4. Compete for party leadership through internal elections.

**Snap elections** (UK, JP, DE, IE): The government can dissolve the lower chamber and call early elections. In UK, snap elections can be triggered by the PM; in JP, by the PM dissolving the Shūgiin; in DE, by the Chancellor dissolving the Bundestag; in IE, by the Taoiseach dissolving the Dáil. The Sangiin (JP upper house) and Bundesrat (DE upper house) cannot be dissolved. Snap elections compress the campaign cycle drastically: see [Snap Elections](/wiki/snap-elections).

**Germany's AMS system** means seat allocation is proportional to party vote share nationally, not just by constituency wins. Third parties are far more viable in Germany than in FPTP countries.

**Ireland's multi-seat constituencies** use Hare-quota largest-remainder allocation in the live resolver. This makes coalition government the norm rather than the exception. Ireland also separately elects a ceremonial **Uachtarán na hÉireann** (President of Ireland) on a 7-year, two-term-limited nationwide ballot.

## Playing in China

China is a one-party state with three party tiers: the ruling Chinese Communist Party (CCP), approved opposition parties (CDL, CNDCA), and banned parties (player-created NPPs land here by default). The Premier is elected by NPC delegates rather than by a direct national vote.

Critically, the regime is **not immortal**: sustained mismanagement, repression, or unpopular policy degrades two coupled scalars (popular legitimacy + party confidence) that escalate through a four-stage chain ending in regime collapse and forced conversion to a multi-party parliamentary system. The Premier has access to liberalization reforms and can announce a voluntary constitutional convention as an off-ramp. See [One-Party States](/wiki/one-party-states) for the full mechanics.

## Cross-border economic investments

### Corporations

Corporations are created within a country's economy but their sector revenue can flow into any country's currency if the sector operates internationally. Corporate income is paid in the country's home currency. Players can own multiple corporations across countries if they have characters there.

### Sovereign bonds

The bond market supports sovereign bonds issued by national governments. A character in the US can hold UK, DE, and JP government bonds. Bond yields, credit ratings, and default risk all vary by country economic health, tracked in the national metrics.

### Currency exchange (Forex)

When Forex is enabled for the game world, characters can trade between currencies: USD, GBP, EUR (DE and IE), JPY, and CNY. Exchange rates shift based on:

- Trade growth (tracked in federal budgets)
- National inflation rates
- Interest rate differentials between central banks

A character invested in both US and JP politics might also hold JPY positions, betting on Japan's economic trajectory. Central bank chair roles (Fed, Bank of England, ECB, Bank of Japan) give bonus actions and influence over interest rates.

### Cross-border legislation

Some bills are scoped as international, meaning they affect metrics in all countries simultaneously. Passing an international trade bill in the US Congress, for example, can shift economic metrics globally. Watch the legislation feed across countries to spot these.

## Coordinating across countries as a team

Since individual characters are country-locked, multi-country play typically means players coordinating across the same party's different national branches (where they exist) or through separate informal coordination:

- **Party coordination:** Establish the same party in multiple countries and coordinate platforms. UK Labour and German SPD can run compatible economic platforms to create aligned demographics in both countries.
- **Economic coordination:** A player in each country can synchronize legislation to benefit shared corporations (e.g., both countries passing favorable tech sector policies).
- **Forex coordination:** If one player controls the Bank of England and another controls the Federal Reserve, they can coordinate interest rate decisions to influence EUR/GBP exchange rates.

## Country entry and navigation

Each country has its own navigation hub:

- **US:** \`/dashboard\` (home), \`/country/us\`
- **UK:** \`/country/uk\`
- **Germany:** \`/country/de\`
- **Japan:** \`/country/jp\`
- **China:** \`/country/cn\`
- **Ireland:** \`/country/ie\`

Each hub includes the legislature, executive, map, parties, and legislation pages for that country.

## Related

- [Reference: Offices](/wiki/reference-offices): complete office tables for all countries.
- [Snap Elections](/wiki/snap-elections): UK, JP, and DE parliamentary dissolution rules.
- [Advanced Strategy](/wiki/advanced-strategy): career arc planning.
- [Endgame Goals](/wiki/endgame-goals): long-term objectives across countries.
`;
