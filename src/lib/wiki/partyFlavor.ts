/**
 * Flavor text for party wiki pages. Custom entries for known parties,
 * generic template for others.
 *
 * Wiki pages pass `sequentialId` as `partyId`, so lookups also match on
 * normalized party name and abbreviation.
 */
export function getPartyFlavor(
  partyId: string,
  partyName: string,
  abbreviation?: string
): { blurb: string; tips: string[] } {
  type Flavor = { blurb: string; tips: string[] };

  const democrat: Flavor = {
    blurb:
      "The Democratic Party has long positioned itself as the party of working families, civil rights, and progressive reform. From the New Deal to the Great Society to the Affordable Care Act, Democrats have championed government action to expand opportunity and protect vulnerable Americans.",
    tips: [
      "Strong in urban and suburban areas",
      "Tends to favor economic intervention and social liberalism",
      "Key demographics: younger voters, minorities, college-educated",
    ],
  };
  const republican: Flavor = {
    blurb:
      "The Republican Party emphasizes limited government, free markets, and traditional values. From Lincoln's emancipation to Reagan's tax cuts to the modern conservative movement.",
    tips: [
      "Strong in rural and exurban areas",
      "Tends to favor economic freedom and social conservatism",
      "Key demographics: older voters, white evangelicals, business owners",
    ],
  };
  const independent: Flavor = {
    blurb:
      "Independents sit outside the two-party system, appealing to voters who reject partisan labels. Whether running as true independents or caucusing with a major party, they often position themselves as pragmatic problem-solvers above the fray.",
    tips: [
      "Appeals to swing voters and moderates",
      "Often competitive in purple districts",
      "Can form coalitions with either major party",
    ],
  };

  const labour: Flavor = {
    blurb:
      "Labour is the UK's historic party of organised labour, the NHS, and social democracy. From Attlee's postwar settlement to modern centre-left governments, it fights elections on public services, workers' rights, and a managed market economy, and forms governments when it can command the confidence of the Commons.",
    tips: [
      "Strongest in urban England, Wales, and Scotland's cities",
      "Natural governing party when Commons arithmetic allows a majority or confidence-and-supply",
      "Key demographics: working-age urban voters, public-sector workers, ethnic-minority communities",
    ],
  };
  const conservative: Flavor = {
    blurb:
      "The Conservatives are the UK's party of property, prudence, and the Union. They pitch lower taxes, tough borders, and Atlanticist defence while balancing One-Nation paternalism against free-market zeal, and they live or die by commanding a Commons majority or a workable coalition.",
    tips: [
      "Strong in rural and suburban England; fights hard in the Midlands and South",
      "Cabinet and whips culture rewards loyalty; rebellions still make headlines",
      "Key demographics: older homeowners, business owners, Leave-leaning voters",
    ],
  };
  const libDems: Flavor = {
    blurb:
      "The Liberal Democrats are Britain's third force of civil liberties, Europe, and localism. They punch above their seat count in hung Parliaments, thrive on tactical voting, and sell a socially liberal, fiscally careful prospectus that courts graduates and Remainers.",
    tips: [
      "Kingmakers in hung Parliaments; strong in the South West and university towns",
      "Coalition or confidence deals can unlock cabinet seats",
      "Key demographics: graduates, professionals, Europhile suburban voters",
    ],
  };
  const snp: Flavor = {
    blurb:
      "The SNP exists to put Scotland's destiny in Scottish hands. Socially progressive and economically centre-left at Westminster, it dominates Holyrood politics when the independence question is hot and extracts concessions whenever it holds the balance in the Commons.",
    tips: [
      "Overwhelmingly Scotland-focused; irrelevant south of the border",
      "Independence desire and devolution fights define the brand",
      "Key demographics: Scottish Yes voters, younger urban Scots, public-service workers",
    ],
  };
  const plaid: Flavor = {
    blurb:
      "Plaid Cymru is Wales's national party, putting language, community, and self-government first. It contests every Welsh seat, levers Senedd politics, and pushes Westminster for deeper devolution while sitting firmly on the centre-left.",
    tips: [
      "Contest Wales only; bilingual identity is core brand",
      "Useful partner in progressive Commons arithmetic",
      "Key demographics: Welsh-speaking communities, younger left voters in Wales",
    ],
  };
  const greens: Flavor = {
    blurb:
      "The Green Party campaigns for climate urgency, social justice, and a post-growth economics that major parties treat as fringe. Seats are scarce under FPTP, but every percentage point pressures Labour from the left and shapes the net-zero debate.",
    tips: [
      "Hard under FPTP, target progressive urban seats and list-style regional races",
      "Agenda-setting on climate, NHS, and housing more than governing alone",
      "Key demographics: young renters, graduates, environmental activists",
    ],
  };
  const reform: Flavor = {
    blurb:
      "Reform UK is Britain's right-populist insurgency, hostile to immigration, net-zero orthodoxy, and the Westminster consensus. It thrives on protest votes that can spoil Conservative seats and force the Tory agenda rightward.",
    tips: [
      "Threatens Conservative majorities in Leave-heavy England",
      "Punchy media moments matter more than committee grind",
      "Key demographics: older Leave voters, working-class English towns, anti-establishment right",
    ],
  };
  const dup: Flavor = {
    blurb:
      "The DUP is Northern Ireland's hardline unionist voice, socially conservative, fiercely protective of the Union, and pivotal whenever Commons arithmetic needs Ulster votes. Stormont deals and Windsor Framework fights define its Westminster leverage.",
    tips: [
      "Northern Ireland only; kingmaker potential in hung Parliaments",
      "Union and cultural conservatism are non-negotiable brand pillars",
      "Key demographics: Protestant unionist communities in NI",
    ],
  };
  const sinnFein: Flavor = {
    blurb:
      "Sinn Féin is Ireland's republican left, abstentionist at Westminster by tradition in the real world, but in this game a force for Irish unity, social provision, and an end to partition politics. It contests Northern Ireland and shapes every border conversation.",
    tips: [
      "Northern Ireland base; Irish unity and social left economics",
      "Devolution and border polls are the long game",
      "Key demographics: nationalist communities, younger NI left voters",
    ],
  };
  const uup: Flavor = {
    blurb:
      "The Ulster Unionist Party is Northern Ireland's older, more moderate unionist tradition, Atlanticist, pro-UK, and less hardline than the DUP. In eras where it still matters, it competes for the Protestant middle and occasionally holds the Stormont balance.",
    tips: [
      "1991-era strength; competes with the DUP for unionist votes",
      "More coalition-flexible than hardline unionism",
      "Key demographics: moderate unionist professionals in NI",
    ],
  };
  const liberalParty: Flavor = {
    blurb:
      "The historic Liberal Party is the free-trade, nonconformist third force of mid-century Britain, reduced to rural redoubts but still a voice for civil liberties and internationalism before the SDP-Liberal merger created the Liberal Democrats.",
    tips: [
      "1953-era only; tiny seat map in Wales and the West Country",
      "Kingmaker potential is rare but real in tight Commons arithmetic",
      "Key demographics: rural Nonconformists, free-trade professionals",
    ],
  };

  const custom: Record<string, Flavor> = {
    democrat,
    republican,
    independent,
    labour,
    "labour party": labour,
    lab: labour,
    conservative,
    "conservative party": conservative,
    con: conservative,
    "liberal democrats": libDems,
    ld: libDems,
    "scottish national party": snp,
    snp,
    "plaid cymru": plaid,
    pc: plaid,
    "green party": greens,
    grn: greens,
    "reform uk": reform,
    ruk: reform,
    "democratic unionist party": dup,
    dup,
    "sinn féin": sinnFein,
    "sinn fein": sinnFein,
    sf: sinnFein,
    "ulster unionist party": uup,
    uup,
    "liberal party": liberalParty,
    lib: liberalParty,
  };

  const keys = [
    partyId.toLowerCase(),
    partyName.toLowerCase().trim(),
    abbreviation?.toLowerCase().trim(),
  ].filter((k): k is string => Boolean(k));

  for (const key of keys) {
    if (custom[key]) return custom[key];
  }

  return {
    blurb: `${partyName} is one of the political parties competing for influence in A House Divided. Parties shape endorsements, fundraising, and electoral strategy.`,
    tips: [
      "Party affiliation affects primary access and endorsements",
      "Members can run for party leadership positions",
      "Party treasury funds national campaigns and operations",
    ],
  };
}
