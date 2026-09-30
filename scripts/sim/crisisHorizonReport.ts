import type { CrisisHorizonPoint } from "./crisisHorizonTelemetry";
import {
  CRISIS_HORIZON_CALC,
  CRISIS_HORIZON_RETENTION,
  CRISIS_HORIZON_SCHEMA,
  HORIZON_CRISIS_KEYS,
} from "./crisisHorizonTelemetry";

export interface CrisisHorizonManifest {
  runId: string;
  seed: string;
  status: string;
  source: { executedCommit?: string | null };
  crisisHorizonTelemetry?: {
    expectedFirstTurn: number;
    expectedLastTurn: number;
    families: number;
  };
}

export interface CrisisHorizonReport {
  qualification: "complete" | "incomplete";
  reasons: string[];
  provenance: {
    runId: string;
    seed: string;
    sourceCommit: string | null;
    sourceClass: "sandbox";
    schemaVersion: number;
    calculationVersion: number;
    retentionPolicy: string;
  };
  coverage: {
    expectedTurns: number;
    recordedTurns: number;
    expectedPoints: number;
    recordedPoints: number;
    firstYear: number | null;
    lastYear: number | null;
  };
  overlap: {
    turnsWithTwoOrMoreOpen: number;
    peakOpenFamilies: number;
    peakNewResponsesPerTurn: number;
  };
  families: Record<
    string,
    {
      firstRecordedTurn: number | null;
      firstOpenTurn: number | null;
      lastOpenTurn: number | null;
      firstSettlementTurn: number | null;
      relapseTurns: number[];
      maximumIntensity: number | null;
      maximumInfrastructureDamage: number | null;
      maximumRefugees: number | null;
      lastInfrastructureDamage: number | null;
      lastRefugees: number | null;
      aftermathTurns: number;
      eventCount: number;
      responseCount: number;
      automaticResolutionCount: number;
      resolutionCount: number;
      missingStateTurns: number;
    }
  >;
}

const settled = new Set(["settled", "closed"]);
const open = new Set(["active", "ceasefire", "negotiating"]);

export function buildCrisisHorizonReport(
  manifest: CrisisHorizonManifest,
  points: CrisisHorizonPoint[]
): CrisisHorizonReport {
  const reasons: string[] = [];
  const expected = manifest.crisisHorizonTelemetry;
  if (!expected) reasons.push("run manifest lacks crisis telemetry interval");
  if (manifest.status !== "completed") reasons.push(`run status is ${manifest.status}`);
  if (!manifest.source?.executedCommit) reasons.push("executed source commit missing");
  if (expected?.families !== HORIZON_CRISIS_KEYS.length)
    reasons.push("family count differs from registry");
  const first = expected?.expectedFirstTurn ?? 0;
  const last = expected?.expectedLastTurn ?? -1;
  const expectedTurns = Math.max(0, last - first + 1);
  const byTurn = new Map<number, Map<string, CrisisHorizonPoint>>();
  for (const point of points) {
    if (
      point.runId !== manifest.runId ||
      point.manifestRunId !== manifest.runId ||
      point.seed !== manifest.seed ||
      point.codeVersion !== manifest.source?.executedCommit ||
      point.sourceClass !== "sandbox" ||
      point.schemaVersion !== CRISIS_HORIZON_SCHEMA ||
      point.calculationVersion !== CRISIS_HORIZON_CALC ||
      point.retentionPolicy !== CRISIS_HORIZON_RETENTION
    ) {
      reasons.push(`mixed or incomplete provenance at ${point.turn}/${point.defKey}`);
    }
    if (!HORIZON_CRISIS_KEYS.some((key) => key === point.defKey)) {
      reasons.push(`unexpected family ${point.defKey}`);
    }
    if (point.turn < first || point.turn > last)
      reasons.push(`point outside run interval ${point.turn}`);
    const turn = byTurn.get(point.turn) ?? new Map<string, CrisisHorizonPoint>();
    if (turn.has(point.defKey)) reasons.push(`duplicate point ${point.turn}/${point.defKey}`);
    turn.set(point.defKey, point);
    byTurn.set(point.turn, turn);
  }
  for (let turn = first; turn <= last; turn++) {
    const row = byTurn.get(turn);
    for (const key of HORIZON_CRISIS_KEYS) {
      if (!row?.has(key)) reasons.push(`missing ${turn}/${key}`);
    }
    const years = new Set([...(row?.values() ?? [])].map((point) => point.year));
    if (years.size > 1) reasons.push(`mixed year at turn ${turn}`);
  }
  const sorted = [...points].sort((a, b) => a.turn - b.turn || a.defKey.localeCompare(b.defKey));
  let peakOpenFamilies = 0;
  let turnsWithTwoOrMoreOpen = 0;
  let peakNewResponsesPerTurn = 0;
  let priorResponses = 0;
  for (const [, row] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    const count = [...row.values()].filter(
      (point) => point.hasOpened && open.has(point.status ?? "")
    ).length;
    peakOpenFamilies = Math.max(peakOpenFamilies, count);
    if (count >= 2) turnsWithTwoOrMoreOpen++;
    const responses = [...row.values()].reduce((sum, point) => sum + point.responses, 0);
    peakNewResponsesPerTurn = Math.max(peakNewResponsesPerTurn, responses - priorResponses);
    priorResponses = responses;
  }
  const families: CrisisHorizonReport["families"] = {};
  for (const key of HORIZON_CRISIS_KEYS) {
    const series = sorted.filter((point) => point.defKey === key);
    const opened = series.filter((point) => point.hasOpened);
    const firstSettlement = series.find((point) => settled.has(point.status ?? ""));
    const relapseTurns: number[] = [];
    for (let i = 1; i < series.length; i++) {
      if (settled.has(series[i - 1]!.status ?? "") && open.has(series[i]!.status ?? "")) {
        relapseTurns.push(series[i]!.turn);
      }
    }
    const max = (values: Array<number | null | undefined>): number | null => {
      const present = values.filter((value): value is number => typeof value === "number");
      return present.length ? Math.max(...present) : null;
    };
    const lastPoint = series.at(-1);
    families[key] = {
      firstRecordedTurn: series[0]?.turn ?? null,
      firstOpenTurn: opened[0]?.turn ?? null,
      lastOpenTurn: opened.at(-1)?.turn ?? null,
      firstSettlementTurn: firstSettlement?.turn ?? null,
      relapseTurns,
      maximumIntensity: max(series.map((point) => point.intensity)),
      maximumInfrastructureDamage: max(
        series.map((point) => point.consequences?.infrastructureDamage)
      ),
      maximumRefugees: max(series.map((point) => point.consequences?.refugees)),
      lastInfrastructureDamage: lastPoint?.consequences?.infrastructureDamage ?? null,
      lastRefugees: lastPoint?.consequences?.refugees ?? null,
      aftermathTurns: series.filter((point) => point.campaignStage === "aftermath").length,
      eventCount: lastPoint?.events ?? 0,
      responseCount: lastPoint?.responses ?? 0,
      automaticResolutionCount: lastPoint?.automaticResolutions ?? 0,
      resolutionCount: lastPoint?.resolutions ?? 0,
      missingStateTurns: series.filter((point) => point.presence === "absent").length,
    };
  }
  return {
    qualification: reasons.length ? "incomplete" : "complete",
    reasons,
    provenance: {
      runId: manifest.runId,
      seed: manifest.seed,
      sourceCommit: manifest.source?.executedCommit ?? null,
      sourceClass: "sandbox",
      schemaVersion: CRISIS_HORIZON_SCHEMA,
      calculationVersion: CRISIS_HORIZON_CALC,
      retentionPolicy: CRISIS_HORIZON_RETENTION,
    },
    coverage: {
      expectedTurns,
      recordedTurns: byTurn.size,
      expectedPoints: expectedTurns * HORIZON_CRISIS_KEYS.length,
      recordedPoints: points.length,
      firstYear: sorted[0]?.year ?? null,
      lastYear: sorted.at(-1)?.year ?? null,
    },
    overlap: { turnsWithTwoOrMoreOpen, peakOpenFamilies, peakNewResponsesPerTurn },
    families,
  };
}

export function renderCrisisHorizonMarkdown(report: CrisisHorizonReport): string {
  const cell = (value: number | null): string => (value === null ? "unknown" : String(value));
  const lines = [
    "# Seven-family crisis horizon",
    "",
    `Qualification: **${report.qualification}**`,
    `Run: \`${report.provenance.runId}\`; seed: \`${report.provenance.seed}\`; executed source: \`${report.provenance.sourceCommit ?? "unknown"}\``,
    `Source: sandbox; schema ${report.provenance.schemaVersion}; calculation ${report.provenance.calculationVersion}; retention ${report.provenance.retentionPolicy}. Full effective run manifest remains in simRuns under the run ID.`,
    `Coverage: ${report.coverage.recordedPoints}/${report.coverage.expectedPoints} family-turn rows, ${report.coverage.recordedTurns}/${report.coverage.expectedTurns} processed turns, game years ${cell(report.coverage.firstYear)} to ${cell(report.coverage.lastYear)}.`,
    `Overlap: ${report.overlap.turnsWithTwoOrMoreOpen} turns with at least two active families; peak ${report.overlap.peakOpenFamilies} active families; peak ${report.overlap.peakNewResponsesPerTurn} recorded choices in one turn.`,
    "",
    "| Family | First open turn | First settlement | Relapses | Peak intensity | Peak infrastructure damage | Peak refugees | Last damage | Last refugees | Aftermath turns | Events | Decisions | Auto resolutions |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [key, family] of Object.entries(report.families)) {
    lines.push(
      `| ${key} | ${cell(family.firstOpenTurn)} | ${cell(family.firstSettlementTurn)} | ${family.relapseTurns.length} | ${cell(family.maximumIntensity)} | ${cell(family.maximumInfrastructureDamage)} | ${cell(family.maximumRefugees)} | ${cell(family.lastInfrastructureDamage)} | ${cell(family.lastRefugees)} | ${family.aftermathTurns} | ${family.eventCount} | ${family.responseCount} | ${family.automaticResolutionCount} |`
    );
  }
  lines.push(
    "",
    "Damage and displacement are the authored campaign consequence indices. They are not currency losses or refugee headcounts. A missing state is recorded as absent, and absent consequence values are unknown rather than zero."
  );
  if (report.reasons.length)
    lines.push("", "## Incomplete evidence", "", ...report.reasons.map((reason) => `- ${reason}`));
  return `${lines.join("\n")}\n`;
}
