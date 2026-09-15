import { createHash } from "node:crypto";

export type TraceJson =
  null | boolean | number | string | TraceJson[] | { [key: string]: TraceJson };

export const OBSERVATION_DOMAINS = [
  "resources",
  "elections",
  "budgets",
  "policies",
  "playerConsequences",
] as const;

export type ObservationDomain = (typeof OBSERVATION_DOMAINS)[number];
export type MongoObservation = Record<ObservationDomain, TraceJson>;
export interface PhaseCapture {
  name: string;
  observations: MongoObservation;
}

function canonical(value: TraceJson): TraceJson {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key]!)])
    );
  }
  return value;
}

function normalize(
  value: unknown,
  ids: Map<string, string>,
  dates: Map<string, string>
): TraceJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Mongo observation contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, ids, dates));
  if (!value || typeof value !== "object") throw new Error("Mongo observation is not JSON-safe");
  const row = value as Record<string, unknown>;
  if (typeof row.$oid === "string" && Object.keys(row).length === 1) {
    if (!ids.has(row.$oid)) ids.set(row.$oid, `generated-id-${ids.size + 1}`);
    return ids.get(row.$oid)!;
  }
  if (typeof row.$date === "string" && Object.keys(row).length === 1) {
    if (!dates.has(row.$date)) dates.set(row.$date, `generated-time-${dates.size + 1}`);
    return dates.get(row.$date)!;
  }
  return Object.fromEntries(
    Object.keys(row)
      .sort()
      .map((key) => [key, normalize(row[key], ids, dates)])
  );
}

/**
 * Normalize only Mongo Extended JSON identity and wall-clock wrappers. Gameplay
 * numbers, branches, collection membership, and array order remain untouched.
 */
export function normalizeMongoObservation(value: unknown): MongoObservation {
  const ids = new Map<string, string>();
  const dates = new Map<string, string>();
  const normalized = normalize(value, ids, dates) as Record<string, TraceJson>;
  for (const domain of OBSERVATION_DOMAINS) {
    if (!(domain in normalized)) throw new Error(`Missing observation domain ${domain}`);
  }
  const extras = Object.keys(normalized).filter(
    (key) => !OBSERVATION_DOMAINS.includes(key as ObservationDomain)
  );
  if (extras.length) throw new Error(`Unknown observation domains: ${extras.join(",")}`);
  return normalized as MongoObservation;
}

interface Mutation {
  path: string;
  before?: TraceJson;
  after?: TraceJson;
}

function mutations(before: TraceJson, after: TraceJson, path = ""): Mutation[] {
  if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      mutations(before[key] ?? null, after[key] ?? null, path ? `${path}.${key}` : key)
    );
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, index) =>
      mutations(item, after[index]!, path ? `${path}.${index}` : String(index))
    );
  }
  return [{ path, before, after }];
}

function sha256(value: TraceJson): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function buildDifferentialTrace(input: {
  revision: string;
  fixtureId: string;
  era: string;
  countryId: string;
  seed: string;
  sourceSha256: string;
  initial: MongoObservation;
  captures: readonly PhaseCapture[];
}) {
  let previous = input.initial;
  const unobservable = {
    status: "unobservable-fail-closed",
    reason: "AHDGame phase RNG streams do not expose draw observations at this revision.",
    source: "src/simulation/engine/turnPhaseRuntime.ts",
  } as const;
  const phases = input.captures.map((capture, index) => {
    const observations = Object.fromEntries(
      OBSERVATION_DOMAINS.map((domain) => [
        domain,
        {
          mutations: mutations(previous[domain], capture.observations[domain]),
        },
      ])
    );
    previous = capture.observations;
    return {
      index,
      name: capture.name,
      rng: { before: unobservable, after: unobservable, draws: [] },
      observations,
    };
  });
  return {
    schemaVersion: 1,
    engine: { kind: "ahdgame", revision: input.revision },
    input: {
      fixtureId: input.fixtureId,
      era: input.era,
      countryId: input.countryId,
      seed: input.seed,
      canonicalInputSha256: sha256(input.initial),
      source: { kind: "mongo", sha256: input.sourceSha256 },
    },
    adaptations: [],
    phases,
  } as const;
}
