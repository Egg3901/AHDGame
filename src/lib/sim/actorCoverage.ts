/**
 * Actor-coverage registry for worldsim balance runs (issue #1993).
 *
 * Fresh preset worldsims contain no `characters` or `users`, while several
 * mechanics require a player character or player executive and offer no NPP
 * fallback. Those systems exercise a permanent-vacancy branch rather than the
 * representative game path, and reports must not present that branch as
 * balance evidence.
 *
 * This module is the single source of truth for which mechanics are
 * actor-gated and how each simulation actor mode (`pure-npp` vs `synthetic`)
 * covers them. It is deliberately pure: no database, no wall clock, no
 * randomness, no env, no network — so the manifest it builds is deterministic
 * and unit-testable, and the registry can run in any future host.
 *
 * Drift guard: every entry names the source seam(s) that gate on actors plus
 * a stable anchor string inside each seam. `actorCoverageSeams()` exposes
 * them and the test suite asserts each anchor is still present, so renaming
 * or removing a gate fails the build instead of silently drifting the
 * manifest. New actor-gated mechanics must add a registry entry; report and
 * probe call sites must resolve ids through `assertKnownActorMechanic`, which
 * throws on unregistered ids.
 */

/** How a run provides (or fails to provide) player actors. */
export type SimActorMode = "pure-npp" | "synthetic";

/** Coverage of one actor-gated mechanic in one actor mode. */
export type ActorGateStatus = "covered" | "partial" | "unreachable";

/** Registry version stamped into every manifest; bump on entry changes. */
export const ACTOR_COVERAGE_REGISTRY_VERSION = 3;

/** Exact explicit result for the presidential-nomination gate in pure NPP mode. */
export const UNCOVERED_PRESIDENTIAL_NOMINATION = "uncovered: presidential nomination";

/** Source seam that gates on actors: file plus a stable anchor string in it. */
export interface ActorGateSeam {
  /** Repo-relative source path, e.g. `src/lib/turn/centralBankChairSelection.ts`. */
  path: string;
  /** Stable string that must still appear in that file. */
  anchor: string;
}

export interface ActorGatedMechanic {
  /** Stable machine-readable id, used by manifests, warnings, and probes. */
  id: string;
  /** Human label for reports. */
  label: string;
  /** What the mechanic needs that only an actor can supply. */
  requires: string;
  /** Code seams where the actor gate lives. */
  seams: ActorGateSeam[];
  pureNpp: { status: ActorGateStatus; reason: string };
  synthetic: { status: ActorGateStatus; reason: string };
}

function seam(path: string, anchor: string): ActorGateSeam {
  return { path, anchor };
}

export const ACTOR_GATED_MECHANICS: readonly ActorGatedMechanic[] = [
  {
    id: "forex-orders",
    label: "Peer forex orders and settlement",
    requires: "characters funding and submitting currency orders",
    seams: [
      seam("src/app/api/forex/orders/route.ts", "Atomic escrow"),
      seam("src/lib/turn/forexTurn.ts", "Find open/partial limit orders"),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "pure NPP worlds have no character wallets and the forex order book is " +
        "character-owned, so rate drift is macro-only and zero orders or fills " +
        "must not be presented as forex-market qualification.",
    },
    synthetic: {
      status: "partial",
      reason:
        "synthetic characters and wallets make the order path reachable, but the " +
        "harness does not yet guarantee a funded order and retained fill in every run.",
    },
  },
  {
    id: "presidential-nomination",
    label: "Presidential nominations",
    requires: "player characters standing for a party presidential nomination",
    seams: [
      seam(
        "src/lib/turn/election/conventionResolution.ts",
        "Resolve a single party's presidential nomination"
      ),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: presidential nomination — pure NPP runs contain zero player " +
        "characters, so no party presidential nomination can resolve through its " +
        "representative path.",
    },
    synthetic: {
      status: "covered",
      reason:
        "synthetic simulation-only actors stand for nomination through the same " +
        "convention resolution path.",
    },
  },
  {
    id: "central-bank-chair-us",
    label: "US central-bank chair seating",
    requires: "a presidential nomination plus Senate confirmation of a player character",
    seams: [
      seam(
        "src/lib/turn/centralBankChairSelection.ts",
        "leaving the Fed chair vacant for presidential nomination"
      ),
      seam(
        "src/app/api/country/[code]/central-bank/nominate/route.ts",
        "Only player characters can be nominated"
      ),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: presidential nomination — FOMC-committee banks seat only via " +
        "presidential nomination, never via an engine-appointed technocrat, so with " +
        "zero nominations the US chair stays permanently vacant.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic executive nominates a synthetic player character and the " +
        "synthetic nominee accepts, exercising the simulated presidential route.",
    },
  },
  {
    id: "central-bank-chair-non-us",
    label: "Non-US central-bank chair seating",
    requires: "player nomination preferred; NPP caretaker fallback exists under autonomy",
    seams: [
      seam(
        "src/lib/turn/centralBankChairSelection.ts",
        "Non-committee banks keep the caretaker technocrat when autonomy is on"
      ),
    ],
    pureNpp: {
      status: "partial",
      reason:
        "non-committee banks seat an NPP caretaker technocrat under autonomy, but " +
        "the player nomination and acceptance path is never exercised.",
    },
    synthetic: {
      status: "covered",
      reason:
        "synthetic player characters flow through the nomination and acceptance " +
        "path ahead of the caretaker fallback.",
    },
  },
  {
    id: "player-country-offices",
    label: "Player-enabled-country offices",
    requires: "player characters holding national office",
    seams: [seam("src/lib/sim/forceFullAutonomy.ts", "off the player rail")],
    pureNpp: {
      status: "partial",
      reason:
        "offices are seated through NPP autonomy rails after the harness forces " +
        "every country off the player rail; player office-holding itself is never " +
        "exercised.",
    },
    synthetic: {
      status: "covered",
      reason:
        "synthetic actors hold executive and legislative offices, including a " +
        "seated US president.",
    },
  },
  {
    id: "state-party-leadership",
    label: "State-party leadership elections",
    requires: "player characters declaring candidacy for chair, vice chair, treasurer",
    seams: [seam("src/lib/statePartyElections.ts", "no candidates — position unchanged")],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: state-party candidacy — candidacy is declared by player " +
        "characters and NPPs cannot stand, so every office resolves through the " +
        "no-candidate branch and positions stay vacant.",
    },
    synthetic: {
      status: "covered",
      reason:
        "synthetic party members declare candidacy and vote, seating offices " +
        "through the representative election path.",
    },
  },
  {
    id: "campaigns-player-actions",
    label: "Campaigns and player actions",
    requires: "player characters running campaigns and spending action points",
    seams: [
      seam("src/lib/db/types/campaign.ts", "One lever's branch-tree state"),
      seam("src/lib/campaigns/actions.ts", "The whole per-turn accrual rule, in one place."),
      seam(
        "src/lib/campaigns/commands/campaignCommands.ts",
        "Target required for opposition research"
      ),
      seam("src/lib/sim/oppositionResearchDriver.ts", "opposition-research flow driver"),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: player campaigns — turn summaries report zero campaigns and " +
        "zero player actions because no actor exists to run them.",
    },
    synthetic: {
      status: "partial",
      reason:
        "synthetic actors accrue per-turn campaign actions through the production " +
        "accrual rule, and an opposition-research entry/spend flow driver exists — " +
        "but this run retained no successful full-sequence purchase, so no campaign " +
        "is entered and no action is spent here.",
    },
  },
  {
    id: "crisis-decisions",
    label: "Crisis decision paths",
    requires: "a player choosing decision-tree options on a crisis interaction",
    seams: [
      seam("src/lib/crises/interactionEngine.ts", "resolutionPath"),
      seam("src/lib/crises/featureFlag.ts", "decision trees, collective"),
    ],
    pureNpp: {
      status: "partial",
      reason:
        "crisis spawning, passive effects, duration, and automatic expiry are " +
        "covered, but the player-facing decision tree is not: resolved " +
        "interactions complete with an empty resolution path and zero chosen options.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic decision-maker chooses crisis options, recording non-empty " +
        "resolution paths and outcome effects.",
    },
  },
  {
    id: "character-wealth",
    label: "Character portfolio wealth",
    requires: "characters holding cash, shares, bonds, and fund units",
    seams: [
      seam("src/lib/wealth/computeCharacterWealth.ts", "ONE definition of a character's net worth"),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: character wealth — zero characters exist, so portfolio " +
        "components and turn-to-turn wealth changes cannot be observed.",
    },
    synthetic: {
      status: "covered",
      reason: "synthetic characters hold portfolios whose components are revalued each turn.",
    },
  },
  {
    id: "household-wealth",
    label: "Household and wealth-list aggregation",
    requires: "a character population to aggregate into households and rankings",
    seams: [seam("src/app/api/stock-exchange/wealth-list/route.ts", "computeCharacterWealth")],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: household wealth — zero observed households with null wealth " +
        "median, Gini, and top-ten share, so no wealth-concentration conclusion is supported.",
    },
    synthetic: {
      status: "covered",
      reason:
        "synthetic households aggregate into median, Gini, top-ten share, and " +
        "wealth-list history rows.",
    },
  },
  {
    id: "corp-founding-private",
    label: "Player-founded private corporations",
    requires: "an authenticated character choosing founding capital",
    seams: [seam("src/app/api/corporations/route.ts", "Get character")],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: player founding — founding requires an authenticated " +
        "character and a founding-capital choice, so only autonomous NPP entrants " +
        "exist and the pre-first-turn founding transient is never observed.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic founder creates a deterministic private corporation with a " +
        "recorded founding capital, captured before the first turn processes.",
    },
  },
  {
    id: "corp-founding-ipo",
    label: "Founding IPO placement",
    requires: "a player-run corporation placing shares publicly at founding",
    seams: [seam("src/lib/corporations/ipoIssuance.ts", "how many new shares to issue")],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: founding IPO — no player corporation exists to place shares, " +
        "so issuance proceeds, placed float, and the price/book path after " +
        "listing are never observed.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic founder takes a deterministic corporation public at " +
        "founding, capturing issued/placed shares, proceeds, market cap, book " +
        "value, and price/book across recomputations.",
    },
  },
  {
    id: "dd-finance-minister-survey",
    label: "DD finance-minister national survey",
    requires: "a seated finance-minister character attempting a government survey",
    seams: [seam("src/app/api/prospecting/government/route.ts", "head of gov / finance minister")],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: minister survey action — the national survey authorizes the " +
        "head of government or the seated finance minister, and no player " +
        "character holds either seat.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic DD finance minister attempts an eligible national survey, " +
        "recording request status, authorization, treasury movement, and the " +
        "inserted survey.",
    },
  },
  {
    id: "uk-no-confidence-lifecycle",
    label: "UK no-confidence motion lifecycle",
    requires:
      "an eligible opposition Commons MP to propose plus seated voters for a deterministic ballot",
    seams: [
      seam(
        "src/lib/government/commands/parliamentaryGovernment.ts",
        "A no-confidence vote is already in progress"
      ),
      seam(
        "src/lib/turn/parliamentaryGovernment.ts",
        "Resolve an expired no-confidence vote for the given country."
      ),
      seam("src/lib/government/queries/parliamentaryGovernment.ts", "No-confidence vote not found"),
    ],
    pureNpp: {
      status: "unreachable",
      reason:
        "uncovered: no-confidence lifecycle — proposing requires an eligible " +
        "elected Commons MP and pure NPP runs contain zero player characters, " +
        "so no motion can ever reach the query surface or the turn resolver.",
    },
    synthetic: {
      status: "covered",
      reason:
        "a synthetic opposition MP proposes through the real no-confidence " +
        "command, a fixed ballot is cast through the real vote seam, and the " +
        "same vote identity is retained through closesOnTurn into exactly-once " +
        "turn resolution.",
    },
  },
];

/** Every known actor-gated mechanic id. Reports and probes must resolve through
 * `assertKnownActorMechanic`; adding a mechanic means adding it here. */
export const ACTOR_GATED_MECHANIC_IDS: readonly string[] = ACTOR_GATED_MECHANICS.map((m) => m.id);

/** Every source seam the registry pins, flattened across mechanics. The drift
 * guard test reads each file and asserts its anchor is still present, so a
 * renamed or removed actor gate fails the build instead of silently drifting
 * the manifest. */
export function actorCoverageSeams(): ActorGateSeam[] {
  return ACTOR_GATED_MECHANICS.flatMap((m) => m.seams.map((s) => ({ ...s })));
}

/** Throw on an unregistered mechanic id so new report/probe call sites cannot
 * silently reference a mechanic the manifest does not classify. */
export function assertKnownActorMechanic(id: string): string {
  if (!ACTOR_GATED_MECHANIC_IDS.includes(id)) {
    throw new Error(
      `Unknown actor-gated mechanic "${id}" (registry v${ACTOR_COVERAGE_REGISTRY_VERSION}, ` +
        `${ACTOR_GATED_MECHANICS.length} mechanics). Register it in ` +
        "src/lib/sim/actorCoverage.ts before referencing it from reports or probes."
    );
  }
  return id;
}

/** Actor population observed in a world. Counts, not documents. */
export interface ActorPopulationSnapshot {
  mode: SimActorMode;
  /** Total characters (synthetic included). */
  characters: number;
  /** Total users (synthetic included). */
  users: number;
  /** Characters marked simulation-only. */
  syntheticCharacters: number;
  /** Users marked simulation-only. */
  syntheticUsers: number;
  /** State-party candidacy records. */
  statePartyCandidates: number;
  /** Crisis interactions that recorded a chosen option. */
  crisisDecidedInteractions: number;
  /** Wealth-list history rows. */
  wealthListRows: number;
  /** Corporations founded by a player/synthetic founder (private + IPO). */
  playerFoundedCorps: number;
  /** World preset, for evidence context (e.g. "1953-default"). */
  preset: string;
  /**
   * True when a run retained a successful full opposition-research command
   * sequence (entry, eligible query, stable selection, purchase, reconciled
   * debits, persisted target, four-turn effects) via the flow driver. The
   * pinned report marks campaigns covered ONLY on this evidence — a generic
   * actor run without it stays partial.
   */
  oppoFlowSucceeded: boolean;
}

export interface ActorCoverageEntry {
  id: string;
  label: string;
  status: ActorGateStatus;
  reason: string;
  evidence: string;
}

export interface ActorCoverageManifest {
  registryVersion: number;
  mechanicCount: number;
  mode: SimActorMode;
  preset: string;
  actorPopulation: {
    characters: number;
    users: number;
    syntheticCharacters: number;
    syntheticUsers: number;
  };
  entries: ActorCoverageEntry[];
  /** Wall-clock ISO timestamp supplied by the caller (this module has no clock). */
  evaluatedAt: string;
}

function evidenceFor(id: string, s: ActorPopulationSnapshot): string {
  const pop =
    `characters=${s.characters} users=${s.users} ` +
    `syntheticCharacters=${s.syntheticCharacters} syntheticUsers=${s.syntheticUsers}`;
  switch (id) {
    case "presidential-nomination":
    case "central-bank-chair-us":
    case "player-country-offices":
      return `${pop}; preset=${s.preset}`;
    case "forex-orders":
      return `${pop}; currency orders require character-owned escrow`;
    case "state-party-leadership":
      return `${pop}; statePartyCandidates=${s.statePartyCandidates}`;
    case "campaigns-player-actions":
      return `${pop}; campaigns are absent when characters=0; oppoFlowSucceeded=${s.oppoFlowSucceeded}`;
    case "crisis-decisions":
      return `${pop}; crisisDecidedInteractions=${s.crisisDecidedInteractions}`;
    case "character-wealth":
      return `${pop}; wealthListRows=${s.wealthListRows}`;
    case "household-wealth":
      return `${pop}; wealthListRows=${s.wealthListRows} (zero rows render null median/Gini/top-ten)`;
    case "corp-founding-private":
    case "corp-founding-ipo":
      return `${pop}; playerFoundedCorps=${s.playerFoundedCorps}`;
    case "central-bank-chair-non-us":
      return `${pop}; caretaker path only`;
    case "dd-finance-minister-survey":
      return `${pop}; no seated minister without actors`;
    case "uk-no-confidence-lifecycle":
      return `${pop}; no Commons proposer without actors`;
    default:
      return pop;
  }
}

/** Reason used when synthetic mode was requested but no synthetic actors were
 * materialized in the world. The deterministic plan exists, but zero synthetic
 * characters means actor-gated paths are UNREACHABLE here — the manifest must
 * not claim them covered just because the mode flag was set. */
export const SYNTHETIC_UNSEEDED_REASON =
  "synthetic mode was requested but this world contains zero synthetic characters, " +
  "so the deterministic actor plan was not materialized and actor-gated paths " +
  "stay UNREACHABLE here, not covered.";

/** Build the effective run manifest's actor-coverage section. Pure and
 * deterministic for a given snapshot and timestamp. */
export function evaluateActorCoverage(
  snapshot: ActorPopulationSnapshot,
  evaluatedAt: string
): ActorCoverageManifest {
  // A mode flag without materialized actors proves nothing: degrade every
  // synthetic-covered entry to unreachable so reports warn instead of
  // presenting vacancies as balance evidence.
  const seeded = snapshot.mode === "pure-npp" || snapshot.syntheticCharacters > 0;
  const entries = ACTOR_GATED_MECHANICS.map((m) => {
    const perMode = snapshot.mode === "synthetic" ? m.synthetic : m.pureNpp;
    const degraded = snapshot.mode === "synthetic" && !seeded && perMode.status === "covered";
    // Campaigns upgrade to covered only on retained full-sequence evidence
    // from the opposition-research flow driver: a generic synthetic run with
    // no entry, purchase, or effects stays partial, never covered.
    const oppoCovered =
      m.id === "campaigns-player-actions" &&
      snapshot.mode === "synthetic" &&
      seeded &&
      snapshot.oppoFlowSucceeded;
    return {
      id: assertKnownActorMechanic(m.id),
      label: m.label,
      status: (degraded
        ? "unreachable"
        : oppoCovered
          ? "covered"
          : perMode.status) as ActorGateStatus,
      reason: degraded
        ? SYNTHETIC_UNSEEDED_REASON
        : oppoCovered
          ? "synthetic actors entered campaigns, selected a stable eligible target, " +
            "purchased opposition research through the production command, and retained " +
            "reconciled debits plus four-turn effects (opposition-research flow driver)."
          : perMode.reason,
      evidence: evidenceFor(m.id, snapshot),
    };
  });
  return {
    registryVersion: ACTOR_COVERAGE_REGISTRY_VERSION,
    mechanicCount: ACTOR_GATED_MECHANICS.length,
    mode: snapshot.mode,
    preset: snapshot.preset,
    actorPopulation: {
      characters: snapshot.characters,
      users: snapshot.users,
      syntheticCharacters: snapshot.syntheticCharacters,
      syntheticUsers: snapshot.syntheticUsers,
    },
    entries,
    evaluatedAt,
  };
}

/** Entries whose status is not `covered`. */
export function uncoveredEntries(manifest: ActorCoverageManifest): ActorCoverageEntry[] {
  return manifest.entries.filter((e) => e.status !== "covered");
}

/**
 * Prominent warnings for reports whose conclusions touch an actor-gated
 * system that was partial or unreachable. Empty when everything relevant is
 * covered — reports must still record the manifest, but render no warning.
 */
export function actorCoverageWarnings(manifest: ActorCoverageManifest): string[] {
  return uncoveredEntries(manifest).map(
    (e) =>
      `ACTOR-COVERAGE WARNING: ${e.label} is ${e.status.toUpperCase()} in ${manifest.mode} ` +
      `mode (preset ${manifest.preset}). ${e.reason} Evidence: ${e.evidence}. ` +
      `Do not present null, zero, or permanently vacant readings for this system ` +
      `as representative balance evidence.`
  );
}

/** FNV-1a hex digest (32 bits, 8 hex chars) of seed + role. Deterministic
 * across processes; the same routine the harness uses for seeded RNG. Exported
 * so seeders can derive other deterministic per-seed values (e.g. corporation
 * sequential ids) from the same stream without inventing a second hash. */
export function fnv1aHex(text: string): string {
  let state = 2_166_136_261;
  for (let index = 0; index < text.length; index++) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return (state >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic 24-hex ObjectId string for a synthetic actor role. The same
 * seed and role always yield the same id, so synthetic populations are
 * reproducible and re-seeding is idempotent. Returned as hex (not ObjectId)
 * to keep this module dependency-free; the seeder converts.
 */
export function syntheticObjectIdHex(seed: string, role: string): string {
  return (
    fnv1aHex(`${seed}:actor:${role}:a`) +
    fnv1aHex(`${seed}:actor:${role}:b`) +
    fnv1aHex(`${seed}:actor:${role}:c`)
  );
}

/** Roles the synthetic-actor seeder creates. Frozen so tests pin the population. */
export const SYNTHETIC_ACTOR_ROLES = [
  "us-president",
  "us-fed-nominee",
  "us-state-party-member",
  "us-founder-private",
  "us-founder-ipo",
  "crisis-decider",
  "dd-finance-minister",
] as const;

export type SyntheticActorRole = (typeof SYNTHETIC_ACTOR_ROLES)[number];
