/** Validates observed world trajectories for #2319 without imputing absent values. */
import type { CentralBankCredibilityPoint } from "./centralBankCredibilitySnapshot";

export interface CredibilityRunManifest {
  runId: string;
  seed: string;
  status: string;
  source?: { executedCommit?: string | null };
  centralBankCredibilityTelemetry?: {
    schemaVersion: number;
    expectedFirstTurn: number;
    expectedLastTurn: number;
    bankIds: string[];
  };
}

export function assertCredibilityReportInterval(interval: {
  firstTurn: number;
  lastTurn: number;
}): void {
  const { firstTurn, lastTurn } = interval;
  if (
    !Number.isInteger(firstTurn) ||
    !Number.isInteger(lastTurn) ||
    firstTurn < 0 ||
    lastTurn < firstTurn ||
    lastTurn - firstTurn > 240
  ) {
    throw new Error("Credibility report requires at most 240 turns plus an opening observation");
  }
}

export function buildCentralBankCredibilityReport(
  manifest: CredibilityRunManifest,
  points: CentralBankCredibilityPoint[],
  interval: { firstTurn: number; lastTurn: number }
) {
  assertCredibilityReportInterval(interval);
  const { firstTurn, lastTurn } = interval;
  const expected = manifest.centralBankCredibilityTelemetry;
  const reasons: string[] = [];
  if (
    !expected ||
    expected.schemaVersion !== 1 ||
    expected.bankIds.length === 0 ||
    expected.bankIds.length > 128 ||
    new Set(expected.bankIds).size !== expected.bankIds.length ||
    firstTurn < expected.expectedFirstTurn ||
    lastTurn > expected.expectedLastTurn
  ) {
    reasons.push("missing or incompatible capture interval");
  }
  if (manifest.status !== "completed") reasons.push(`run status is ${manifest.status}`);
  if (!/^[0-9a-f]{40}$/.test(manifest.source?.executedCommit ?? "")) {
    reasons.push("executed source commit missing");
  }
  const keys = new Set<string>();
  for (const point of points) {
    const key = `${point.turn}:${point.bankId}`;
    if (keys.has(key)) reasons.push(`duplicate ${key}`);
    keys.add(key);
    if (
      point.runId !== manifest.runId ||
      point.seed !== manifest.seed ||
      point.codeVersion !== manifest.source?.executedCommit ||
      point.schemaVersion !== 1 ||
      point.sourceClass !== "sandbox" ||
      point.observation !== "completed-turn-state"
    ) {
      reasons.push(`mixed provenance ${key}`);
    }
    if (point.turn < firstTurn || point.turn > lastTurn) reasons.push(`outside interval ${key}`);
  }
  for (const bankId of expected?.bankIds ?? []) {
    for (let turn = firstTurn; turn <= lastTurn; turn++) {
      if (!keys.has(`${turn}:${bankId}`)) reasons.push(`missing ${turn}:${bankId}`);
    }
  }
  const sorted = [...points].sort((a, b) => a.bankId.localeCompare(b.bankId) || a.turn - b.turn);
  const numericFields = [
    "endPrimeRatePct",
    "scrutiny",
    "resolveStreak",
    "countryInflationPct",
    "nationalGdpGrowthPct",
  ] as const;
  const missingValues = Object.fromEntries(
    numericFields.map((field) => [
      field,
      sorted.filter((point) => point[field] === null || !Number.isFinite(point[field])).length,
    ])
  );
  return {
    issue: 2319,
    captureQualification: reasons.length ? "incomplete" : "complete",
    reasons,
    runId: manifest.runId,
    seed: manifest.seed,
    executedCommit: manifest.source?.executedCommit ?? null,
    interval,
    expectedBankIds: expected?.bankIds ?? [],
    missingValues,
    limits:
      "Observed completed-world state, not decision inputs, a controlled policy intervention, or causal calibration. End rates may reflect a subsequent autonomous choice. National growth remains null where no national observation exists. Complete capture does not imply issue acceptance.",
    points: sorted,
  };
}
