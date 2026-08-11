/**
 * Build Commons carve-up slices from an ElectionDisplay's polling / seat shares.
 * Falls back to equal slices across candidates when tallies are thin.
 */
import type { ElectionDisplay } from "@/lib/db/types";
import type { CarveUpSlice } from "@/components/elections/primary/CarveUpPanel";

const UK_DEMOGRAPHIC_HINTS: Record<string, string[]> = {
  LON: ["Urban professionals", "Renters", "Ethnic minority voters"],
  SCO: ["Yes-leaning Scots", "Public-sector workers", "Younger urban"],
  WAL: ["Welsh-speaking communities", "Ex-industrial towns", "Public services"],
  NIR: ["Unionist / nationalist split", "Faith communities", "Border voters"],
  NEE: ["Leave-leaning towns", "Older homeowners", "Manufacturing"],
  NWE: ["Urban Labour belts", "Suburban swingers", "Students"],
  YHU: ["Ex-Red Wall", "Public sector", "Coastal towns"],
  EM: ["Swing Midlands", "Suburban homeowners", "SMEs"],
  WM: ["Urban cores", "Suburban belts", "Faith communities"],
  EE: ["Home Counties edge", "Retirees", "Commuters"],
  SE: ["Affluent suburbs", "Remain graduates", "Small business"],
  SW: ["Rural Liberals", "Retirees", "Tourism towns"],
};

export function buildCommonsCarveUpSlices(election: ElectionDisplay): {
  slices: CarveUpSlice[];
  topDemographics: string[];
} {
  const topDemographics = UK_DEMOGRAPHIC_HINTS[election.state] ?? [
    "Working-age voters",
    "Homeowners",
    "Public-service workers",
  ];

  const shares = election.polling?.sharesPct;
  if (shares && Object.keys(shares).length > 0) {
    const slices: CarveUpSlice[] = [];
    for (const [candidateId, pct] of Object.entries(shares)) {
      const candidate = election.candidates.find((c) => c.id === candidateId);
      if (!candidate) continue;
      slices.push({
        candidateId,
        candidateName: candidate.characterName,
        color: candidate.partyColor ?? "#9CA3AF",
        archetype: candidate.partyName,
        pct: Math.max(0, pct),
      });
    }
    const sum = slices.reduce((s, x) => s + x.pct, 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.5) {
      for (const s of slices) s.pct = (s.pct / sum) * 100;
    }
    return { slices, topDemographics };
  }

  if (election.seatsEstimate && election.totalSeats && election.totalSeats > 0) {
    const slices: CarveUpSlice[] = [];
    for (const [candidateId, seats] of Object.entries(election.seatsEstimate)) {
      const candidate = election.candidates.find((c) => c.id === candidateId);
      if (!candidate || seats <= 0) continue;
      slices.push({
        candidateId,
        candidateName: candidate.characterName,
        color: candidate.partyColor ?? "#9CA3AF",
        archetype: candidate.partyName,
        pct: (seats / election.totalSeats) * 100,
      });
    }
    return { slices, topDemographics };
  }

  const n = election.candidates.length;
  if (n === 0) return { slices: [], topDemographics };
  const even = 100 / n;
  return {
    slices: election.candidates.map((c) => ({
      candidateId: c.id,
      candidateName: c.characterName,
      color: c.partyColor ?? "#9CA3AF",
      archetype: c.partyName,
      pct: even,
    })),
    topDemographics,
  };
}
