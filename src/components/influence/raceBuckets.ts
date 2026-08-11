import type { ElectionContext, NPPCandidacy, NPPOption } from "./types";

export const NOT_RUNNING_KEY = "__not_running";
const NOT_RUNNING_LABEL = "Not Running";

export interface RaceBucketInputs {
  state: string;
  npps: NPPOption[];
  activeElections: ElectionContext[];
  nppCandidacies: NPPCandidacy[];
}

export interface RaceBucket {
  key: string;
  label: string;
  npps: NPPOption[];
}

function titleCase(input: string): string {
  if (!input) return input;
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}

function raceKeyAndLabel(election: ElectionContext): { key: string; label: string } {
  if (election.type === "senate" && typeof election.senateClass === "number") {
    return {
      key: `senate:${election.senateClass}`,
      label: `Senate (Class ${election.senateClass})`,
    };
  }
  return { key: election.type, label: titleCase(election.type) };
}

export function buildRaceBuckets(inputs: RaceBucketInputs): RaceBucket[] {
  const { state, npps, activeElections, nppCandidacies } = inputs;

  const electionsById = new Map(activeElections.map((e) => [e.id, e]));
  const candidacyByNppId = new Map<string, NPPCandidacy>();
  for (const candidacy of nppCandidacies) {
    if (candidacy.nppId && !candidacyByNppId.has(candidacy.nppId)) {
      candidacyByNppId.set(candidacy.nppId, candidacy);
    }
  }

  const bucketsByKey = new Map<string, RaceBucket>();
  const notRunning: NPPOption[] = [];

  for (const npp of npps) {
    const candidacy = candidacyByNppId.get(npp.id);
    const election = candidacy ? electionsById.get(candidacy.electionId) : undefined;

    if (!election || election.state !== state) {
      notRunning.push(npp);
      continue;
    }

    const { key, label } = raceKeyAndLabel(election);
    const existing = bucketsByKey.get(key);
    if (existing) {
      existing.npps.push(npp);
    } else {
      bucketsByKey.set(key, { key, label, npps: [npp] });
    }
  }

  const ordered = Array.from(bucketsByKey.values()).sort((a, b) => a.label.localeCompare(b.label));

  if (notRunning.length > 0) {
    ordered.push({ key: NOT_RUNNING_KEY, label: NOT_RUNNING_LABEL, npps: notRunning });
  }

  return ordered;
}
