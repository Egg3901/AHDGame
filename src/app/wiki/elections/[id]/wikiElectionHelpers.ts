import type { ElectionDetail } from "./wikiElectionTypes";

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function typeLabel(type: string, plural = false): string {
  switch (type) {
    case "president":
      return plural ? "President" : "President";
    case "governor":
      return plural ? "Governors" : "Governor";
    case "senate":
      return plural ? "Senate" : "Senate";
    case "house":
      return plural ? "House" : "House";
    case "stateSenate":
      return plural ? "State Senate" : "State Senate";
    case "commons":
      return plural ? "Commons" : "Commons";
    case "regionalCouncil":
      return plural ? "Regional Councils" : "Regional Council";
    case "shugiin":
      return plural ? "Shūgiin" : "Shūgiin";
    case "sangiin":
      return plural ? "Sangiin" : "Sangiin";
    case "bundestag":
      return plural ? "Bundestag" : "Bundestag";
    case "landtag":
      return plural ? "Landtag" : "Landtag";
    case "ministerPresident":
      return plural ? "Minister-Presidents" : "Minister-President";
    case "npcDelegate":
      return plural ? "NPC Delegates" : "NPC Delegate";
    case "peoplesCongress":
      return plural ? "People's Congresses" : "People's Congress";
    case "dail":
      return plural ? "Dáil Éireann" : "Dáil Éireann";
    case "seanad":
      return plural ? "Seanad Éireann" : "Seanad Éireann";
    case "uachtaran":
      return plural ? "Uachtaráin na hÉireann" : "Uachtarán na hÉireann";
    case "localCouncil":
      return plural ? "Local Councils" : "Local Council";
    default:
      return type;
  }
}

export function generateOverview(election: ElectionDetail, totalVotes: number): string {
  const typeDesc = (() => {
    switch (election.electionType) {
      case "president":
        return "United States Presidential Election";
      case "governor":
        return `${election.stateName} Gubernatorial Election`;
      case "senate":
        return `${election.stateName} United States Senate Election (Class ${election.senateClass})`;
      case "house":
        return `${election.stateName} United States House of Representatives Election`;
      case "stateSenate":
        return `${election.stateName} State Senate Election`;
      case "commons":
        return `${election.stateName} Commons Election`;
      case "regionalCouncil":
        return `${election.stateName} Regional Council Election`;
      case "shugiin":
        return `${election.stateName} Shūgiin Election`;
      case "sangiin":
        return `${election.stateName} Sangiin Election`;
      case "bundestag":
        return `${election.stateName} Bundestag Election`;
      case "landtag":
        return `${election.stateName} Landtag Election`;
      case "ministerPresident":
        return `${election.stateName} Minister-President Election`;
      case "npcDelegate":
        return `${election.stateName} NPC Delegate Election`;
      case "peoplesCongress":
        return `${election.stateName} People's Congress Election`;
      case "dail":
        return `${election.stateName} Dáil Éireann Election`;
      case "seanad":
        return `${election.stateName} Seanad Éireann Election`;
      case "uachtaran":
        return "Uachtarán na hÉireann Election";
      case "localCouncil":
        return `${election.stateName} Local Council Election`;
      default:
        return `${election.stateName} ${typeLabel(election.electionType)} Election`;
    }
  })();

  const dateStr = formatDate(election.endTime);

  if (election.generalResults) {
    const sortedCandidates = Object.entries(election.generalResults.candidateNames)
      .map(([id, name]) => ({
        id,
        name,
        party: election.generalResults!.candidateParties[id],
        votes: election.generalResults!.totalVotes[id] || 0,
        ev: election.generalResults!.electoralVotesByCandidate?.[id],
      }))
      .sort((a, b) => b.votes - a.votes);

    const winner = sortedCandidates[0];
    const runnerUp = sortedCandidates[1];

    if (
      election.electionType === "president" &&
      election.generalResults.electoralVotesByCandidate
    ) {
      return `The ${typeDesc} was held on ${dateStr}, during Cycle ${election.cycle} of the simulation. ${winner.name} of the ${winner.party} secured victory with ${winner.ev} electoral votes, defeating ${runnerUp?.name} of the ${runnerUp?.party} who received ${runnerUp?.ev} electoral votes.`;
    } else if (election.electionType === "house" && election.generalResults.seatsEstimate) {
      const winnerSeats = election.generalResults.seatsEstimate[winner.id];
      return `The ${typeDesc} was held on ${dateStr}, during Cycle ${election.cycle} of the simulation. The ${winner.party} won control with ${winnerSeats} seat${winnerSeats !== 1 ? "s" : ""} out of ${election.totalSeats} total.`;
    } else {
      const winnerPct = totalVotes > 0 ? ((winner.votes / totalVotes) * 100).toFixed(1) : "0";
      return `The ${typeDesc} was held on ${dateStr}, during Cycle ${election.cycle} of the simulation. ${winner.name} of the ${winner.party} won with ${winnerPct}% of the vote.`;
    }
  }

  return `The ${typeDesc} was held on ${dateStr}, during Cycle ${election.cycle} of the simulation.`;
}

export function generateBackground(election: ElectionDetail): string {
  if (!election.generalResults) return "";

  const candidateCount = Object.keys(election.generalResults.candidateNames).length;
  const partyCount = new Set(Object.values(election.generalResults.candidateParties)).size;

  if (election.electionType === "president") {
    const competitive = candidateCount >= 3 ? "multi-way" : "two-way";
    return `This election represented a ${competitive} contest for control of the executive branch, with ${candidateCount} candidate${candidateCount !== 1 ? "s" : ""} from ${partyCount} ${partyCount !== 1 ? "parties" : "party"} competing for the presidency. The race came at a pivotal moment in the nation's political development, with voters weighing competing visions for the country's future direction. The outcome would shape policy priorities and national leadership for the next presidential term.`;
  } else if (election.electionType === "governor") {
    return `This gubernatorial election determined the executive leadership of ${election.stateName} for the coming term. With ${candidateCount} candidate${candidateCount !== 1 ? "s" : ""} competing across party lines, voters faced important choices about state governance, economic priorities, and regional policy direction. The governor's race drew significant attention as a key indicator of political sentiment within the state.`;
  } else if (election.electionType === "senate") {
    return `As part of the staggered Senate election cycle, ${election.stateName}'s Class ${election.senateClass} Senate seat was contested in this election. The race featured ${candidateCount} candidate${candidateCount !== 1 ? "s" : ""} vying for a six-year term in the upper chamber of Congress. The outcome would influence the balance of power in the Senate and shape the state's representation in federal legislative deliberations.`;
  } else if (election.electionType === "house") {
    return `This election encompassed all ${election.totalSeats} House seat${election.totalSeats !== 1 ? "s" : ""} in ${election.stateName}, with voters in each district selecting their representative for a two-year term. The collective results would determine which party controlled the state's House delegation and contributed to the overall partisan balance in the lower chamber of Congress. ${partyCount} ${partyCount !== 1 ? "parties" : "party"} fielded candidates across the various districts, making this a comprehensive test of political strength statewide.`;
  } else {
    return `This state legislative election determined the composition of ${election.stateName}'s State Senate for the coming term. With ${election.totalSeats} seat${election.totalSeats !== 1 ? "s" : ""} at stake, the results would shape state policy-making and legislative priorities. The election attracted ${candidateCount} candidate${candidateCount !== 1 ? "s" : ""} across multiple districts, reflecting diverse political viewpoints within the state.`;
  }
}

export interface CandidateNarrativeEntry {
  name: string;
  party: string;
  votes: number;
  pct: number;
  placement: string;
  ev?: number;
  seats?: number;
}

export function generateCandidatesNarrative(
  election: ElectionDetail,
  totalVotes: number
): CandidateNarrativeEntry[] {
  if (!election.generalResults) return [];

  return Object.entries(election.generalResults.candidateNames)
    .map(([id, name]) => ({
      id,
      name,
      party: election.generalResults!.candidateParties[id],
      votes: election.generalResults!.totalVotes[id] || 0,
      pct: totalVotes > 0 ? ((election.generalResults!.totalVotes[id] || 0) / totalVotes) * 100 : 0,
      ev: election.generalResults!.electoralVotesByCandidate?.[id],
      seats: election.generalResults!.seatsEstimate?.[id],
    }))
    .sort((a, b) => b.votes - a.votes)
    .map((c, i) => ({
      name: c.name,
      party: c.party,
      votes: c.votes,
      pct: c.pct,
      ev: c.ev,
      seats: c.seats,
      placement: i === 0 ? "winner" : i === 1 ? "runner-up" : "participant",
    }));
}

export function generateCampaignNarrative(election: ElectionDetail): string {
  if (!election.generalResults) return "";

  if (election.electionType === "president") {
    return `The general election campaign unfolded over several cycles, with each candidate pursuing distinct strategies to build a winning coalition of electoral votes. Campaign activities included rallies in key battleground states, targeted advertising campaigns, grassroots organizing efforts, and extensive voter outreach. With 270 electoral votes needed to secure the presidency, the candidates focused their resources on competitive swing states where the outcome remained uncertain. The winner-take-all allocation system (with the exceptions of Maine and Nebraska, which use district-based allocation) meant that narrow victories in populous states could prove decisive to the final result.`;
  } else if (election.electionType === "house") {
    return `The campaign encompassed races across all ${election.totalSeats} congressional districts in ${election.stateName}, with candidates mounting individual campaigns tailored to their local constituencies. While each district race had its own dynamics and local issues, broader partisan trends and national political currents influenced voter sentiment across the state. Campaign committees from both major parties invested resources in competitive districts, recognizing that control of the House delegation would impact legislative power and policy priorities in Congress.`;
  } else {
    const candidateCount = Object.keys(election.generalResults.candidateNames).length;
    return `The campaign period saw ${candidateCount} candidate${candidateCount !== 1 ? "s" : ""} engaging with voters through various channels, including public rallies, media appearances, advertising campaigns, and direct voter contact. Each candidate sought to articulate their vision for the office and distinguish themselves from their opponents on key policy priorities. As the election approached, campaign activities intensified, with candidates making final appeals to persuade undecided voters and energize their base of support.`;
  }
}

export function generatePrimaryNarrative(election: ElectionDetail): string | null {
  if (election.primaryResults.length === 0) return null;

  const competitiveRaces = election.primaryResults.filter((p) => p.candidates.length > 1);
  if (competitiveRaces.length === 0) return null;

  const narratives: string[] = [];

  for (const party of competitiveRaces) {
    const winner = party.candidates.find((c) => c.won);
    const runnerUp = party.candidates
      .filter((c) => !c.won)
      .sort((a, b) => b.primaryScore - a.primaryScore)[0];

    if (winner && runnerUp) {
      const margin = (winner.sharePct - runnerUp.sharePct).toFixed(1);
      if (parseFloat(margin) < 10) {
        narratives.push(
          `The ${party.partyName} primary proved competitive, with ${winner.characterName} narrowly defeating ${runnerUp.characterName} with ${winner.sharePct.toFixed(1)}% to ${runnerUp.sharePct.toFixed(1)}% of the weighted primary score.`
        );
      } else {
        narratives.push(
          `${winner.characterName} secured the ${party.partyName} nomination with ${winner.sharePct.toFixed(1)}% of the weighted primary score, comfortably ahead of ${runnerUp.characterName} at ${runnerUp.sharePct.toFixed(1)}%.`
        );
      }
    } else if (winner) {
      narratives.push(
        `${winner.characterName} won the ${party.partyName} nomination with ${winner.sharePct.toFixed(1)}% of the weighted primary score.`
      );
    }
  }

  return narratives.length > 0 ? narratives.join(" ") : null;
}

export function generateResultsNarrative(
  election: ElectionDetail,
  totalVotes: number
): string | null {
  if (!election.generalResults) return null;

  const sortedCandidates = Object.entries(election.generalResults.candidateNames)
    .map(([id, name]) => ({
      id,
      name,
      party: election.generalResults!.candidateParties[id],
      votes: election.generalResults!.totalVotes[id] || 0,
      pct: totalVotes > 0 ? ((election.generalResults!.totalVotes[id] || 0) / totalVotes) * 100 : 0,
      ev: election.generalResults!.electoralVotesByCandidate?.[id],
      seats: election.generalResults!.seatsEstimate?.[id],
    }))
    .sort((a, b) => b.votes - a.votes);

  if (sortedCandidates.length === 0) return null;

  const winner = sortedCandidates[0];
  const others = sortedCandidates.slice(1);

  let narrative = "";

  if (election.electionType === "president") {
    narrative = `${winner.name} secured the presidency with ${winner.ev} electoral votes, ${winner.ev && winner.ev >= 270 ? "exceeding" : "falling short of"} the 270 needed for victory. `;

    if (others.length > 0) {
      const runnerUp = others[0];
      const evMargin = (winner.ev || 0) - (runnerUp.ev || 0);
      narrative += `${runnerUp.name} came in second place with ${runnerUp.ev} electoral votes, making this a ${evMargin < 50 ? "closely contested" : "decisive"} race. `;
    }

    narrative += `In the popular vote, ${winner.name} received ${winner.pct.toFixed(1)}% (${winner.votes.toLocaleString()} votes)`;
    if (others.length > 0) {
      narrative += `, while ${others.map((c) => `${c.name} captured ${c.pct.toFixed(1)}%`).join(" and ")}`;
    }
    narrative += ".";
  } else if (election.electionType === "house" && winner.seats) {
    narrative = `The ${winner.party} won ${winner.seats} seat${winner.seats !== 1 ? "s" : ""} out of ${election.totalSeats} total, `;
    const majority = election.totalSeats ? Math.floor(election.totalSeats / 2) + 1 : 0;
    narrative +=
      winner.seats >= majority ? "securing a majority. " : "falling short of a majority. ";

    if (others.length > 0 && others[0].seats) {
      narrative += `The ${others[0].party} won ${others[0].seats} seat${others[0].seats !== 1 ? "s" : ""}.`;
    }
  } else {
    narrative = `${winner.name} won with ${winner.pct.toFixed(1)}% of the vote (${winner.votes.toLocaleString()} votes). `;

    if (others.length > 0) {
      const runnerUp = others[0];
      const margin = winner.pct - runnerUp.pct;
      narrative += `${runnerUp.name} finished second with ${runnerUp.pct.toFixed(1)}%, `;
      narrative +=
        margin < 5
          ? "making this a closely contested race. "
          : `losing by a margin of ${margin.toFixed(1)} percentage points. `;
    }
  }

  return narrative;
}
