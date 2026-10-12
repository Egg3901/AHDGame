export const referendumsContent = `# Independence and Reunification Referendums

The referendum system models constitutional campaigns in the United Kingdom's devolved regions. Scotland, Wales, and Northern Ireland can seek independence, while Northern Ireland can instead pursue reunification with Ireland.

## What moves desire

Independence Desire in Scotland and Wales, and Reunification Desire in Northern Ireland, changes each turn with the First Minister's devolution policy, regional approval, Westminster’s stance for that region, Westminster approval and UK inflation.

- A pro-independence or reunification policy adds 0.05 points per turn. Anti-devolution subtracts 0.04; pro-devolution contributes zero.
- Regional approval above 50% advances the First Minister's stance; approval below 50% weakens it. Pro-devolution remains neutral on separation.
- Westminster chooses a separate stance for Scotland, Wales and Northern Ireland from the UK Executive Devolution tab. Its direct policy effect is half the First Minister’s: +0.025 for independence or reunification, -0.020 for anti-devolution, and zero for pro-devolution.
- Westminster approval above 50% advances its chosen stance; approval below 50% weakens it. Pro-devolution is neutral. Its approval effect is half the regional effect: 0.001 per approval point from 50%, capped at 0.025 in either direction.
- Changing a Westminster stance costs 2 national office AP, with a separate 72-turn cooldown for each region. Each incoming government may make its first change in each region despite an inherited cooldown, paying the usual AP cost. That change starts a fresh cooldown. The PM and FMs can see both governments’ stances and all drift drivers.
- Each regional approval point from 50% contributes 0.002 points per turn, up to 0.05 in either direction.
- Inflation above 5% adds 0.02 points per turn. Inflation below 2% subtracts 0.01; rates from 2% through 5% contribute zero.
- Desire gradually returns toward 25 by up to 0.003 points per turn when other influences do not outweigh that pull.

There are 48 turns per game year. For example, a pro-independence government at 70% regional approval, with Westminster on pro-devolution, inflation at 3% and desire above 25, gains about 4.2 points per year. Referendum outcomes and Northern Ireland peace-process decisions can also change desire directly.

The office dashboards also project movement over one game year and time to 60 Desire using the current stances, approval and inflation. Recovery and the 0-100 bounds still apply. These conditional estimates exclude event shocks and do not waive referendum cooldowns or parliamentary consent.

## Opening a referendum

A devolved First Minister may file a request from the regional office page when independence desire reaches **60**. Filing costs **3 office actions**. A region cannot open another referendum while one is active or while its previous result is on cooldown.

The UK Prime Minister then grants or declines the request. A granted referendum opens a **48-turn campaign**. A declined request raises independence desire by 5 points and starts a 96-turn cooldown.

Open the live hub at **Country > Referendums**, or go directly to [UK Referendums](/country/uk/referendums).

## Campaigning

The campaign starts from Desire captured when consent is granted. This starting value is fixed: later live Desire drift does not directly change campaign support. The campaign tracks Yes and No support by demographic cohort. Campaign actions can persuade a cohort or mobilize its turnout, with diminishing returns and soft caps. Party chairs and vice chairs may declare a public party position. The detail page shows:

- the current tracking poll and recent momentum;
- party positions;
- cohort support and turnout;
- the campaign wire;
- any consent bills required after a passing vote.

The final vote adds a deterministic swing of up to 4 percentage points. Yes must finish **above 50%** to pass. A failed vote resets independence desire toward 30 and starts a 480-turn cooldown.

## What a passing vote changes

A passing vote opens a 24-turn parliamentary consent ballot. Independence requires the Westminster consent bill before the new country is created. Northern Ireland reunification always requires a Westminster release bill. If Ireland is already open to players when the referendum passes, it also requires a Dáil admission bill. Otherwise Ireland opens to players automatically when the transfer completes. Once the required consent bills are enacted, the region transfers automatically. Government formation and Royal Assent may extend the process. An admin can block conversion or resolve it after the required consent is enacted.

The transfer updates regional ownership, offices, parties, elections, corporations, natural resources, and the affected country maps. It is a world-state change, not a cosmetic result.

## Related pages

- [United Kingdom](/wiki/uk-overview)
- [Ireland](/wiki/ie-overview)
- [Bills and Legislation](/wiki/bills-legislation)
- [Election Mechanics](/wiki/election-mechanics)
`;
