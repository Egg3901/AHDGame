export const referendumsContent = `# Independence and Reunification Referendums

The referendum system models constitutional campaigns in the United Kingdom's devolved regions. Scotland, Wales, and Northern Ireland can seek independence, while Northern Ireland can instead pursue reunification with Ireland.

## What moves desire

Independence Desire in Scotland and Wales, and Reunification Desire in Northern Ireland, changes each turn with the First Minister's devolution policy, regional approval, Westminster approval and UK inflation.

- A pro-independence or reunification policy adds 0.05 points per turn. Anti-devolution subtracts 0.04; pro-devolution contributes zero.
- Regional approval above 50% advances the First Minister's stance; approval below 50% weakens it. Pro-devolution remains neutral on separation.
- Westminster approval below 50% raises desire; approval above 50% lowers it.
- Each approval point from 50% contributes 0.002 points per turn, up to 0.05 in either direction.
- Inflation above 5% adds 0.02 points per turn. Inflation below 2% subtracts 0.01; rates from 2% through 5% contribute zero.
- Desire gradually returns toward 25 by up to 0.003 points per turn when other influences do not outweigh that pull.

There are 48 turns per game year. For example, a pro-independence government at 70% regional approval, with Westminster approval at 50%, inflation at 3% and desire above 25, gains about 4.2 points per year. Referendum outcomes and Northern Ireland peace-process decisions can also change desire directly.

## Opening a referendum

A devolved First Minister may file a request from the regional office page when independence desire reaches **60**. Filing costs **3 office actions**. A region cannot open another referendum while one is active or while its previous result is on cooldown.

The UK Prime Minister then grants or declines the request. A granted referendum opens a **48-turn campaign**. A declined request raises independence desire by 5 points and starts a 96-turn cooldown.

Open the live hub at **Country > Referendums**, or go directly to [UK Referendums](/country/uk/referendums).

## Campaigning

The campaign tracks Yes and No support by demographic cohort. Campaign actions can persuade a cohort or mobilize its turnout, with diminishing returns and soft caps. Party chairs and vice chairs may declare a public party position. The detail page shows:

- the current tracking poll and recent momentum;
- party positions;
- cohort support and turnout;
- the campaign wire;
- any consent bills required after a passing vote.

The final vote adds a deterministic swing of up to 4 percentage points. Yes must finish **above 50%** to pass. A failed vote resets independence desire toward 30 and starts a 480-turn cooldown.

## What a passing vote changes

A passing vote enters a 24-turn conversion window. Independence requires the Westminster consent bill before the new country is created. Northern Ireland reunification always requires a Westminster release bill. If Ireland is already open to players when the referendum passes, it also requires a Dáil admission bill. Otherwise Ireland opens to players automatically when the transfer completes. If the required consent is in place, the region transfers automatically when the window closes. An admin can resolve or block the conversion early.

The transfer updates regional ownership, offices, parties, elections, corporations, natural resources, and the affected country maps. It is a world-state change, not a cosmetic result.

## Related pages

- [United Kingdom](/wiki/uk-overview)
- [Ireland](/wiki/ie-overview)
- [Bills and Legislation](/wiki/bills-legislation)
- [Election Mechanics](/wiki/election-mechanics)
`;
