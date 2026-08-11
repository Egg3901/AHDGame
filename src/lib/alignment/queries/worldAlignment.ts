/**
 * Read path for the Cold War Ledger: every country's alignment for the live
 * world, with the axis / lead / band derivations already applied.
 *
 * Read-only. The only alignment write paths are seeding (plan 2) and the
 * alignment turn phase.
 */
import type { Db } from "mongodb";
import {
  CRISIS_TURN_CAP,
  joinGateForPoleCount,
  polesForYear,
  resolveAlignmentEra,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { ROSTER_BY_KEY } from "@/lib/constants/alignmentRoster";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getAlignmentCrisesCollection, getCountryAlignmentsCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { resolveGameYear } from "@/lib/era/era";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { isIntOrgAlignmentEnabled } from "../featureFlag";
import type { AlignmentStatus } from "../project";
import {
  eraPoleVocabulary,
  projectNationStanding,
  type LedgerPole,
  type NationStanding,
} from "./nationStanding";

export type { LedgerPole };

export type LedgerRow = NationStanding & {
  /** Orgs the country belongs to, for the bloc chips. */
  orgIds: string[];
};

export interface LedgerCrisis {
  id: string;
  targetEntityId: string;
  targetName: string;
  title: string;
  headline: string;
  /** Turns left before it settles. */
  turnsRemaining: number;
  /** Raised movement ceiling while this crisis runs. */
  movementCap: number;
}

export interface WorldAlignmentView {
  enabled: boolean;
  year: number;
  eraKey: string;
  joinGate: number;
  poles: LedgerPole[];
  /** What the remainder is called this era. It IS non-alignment once NAM exists. */
  remainderLabel: string;
  rows: LedgerRow[];
  /** Open flashpoints, soonest to settle first. */
  crises: LedgerCrisis[];
}

/** Rank for grouping the table: decided blocs first, then in-play, then locked. */
const STATUS_ORDER: Record<AlignmentStatus, number> = {
  player: 0,
  locked: 1,
  loyal: 2,
  eligible: 3,
  "defection-risk": 4,
  contested: 5,
  "non-aligned": 6,
};

export async function loadWorldAlignment(db: Db): Promise<WorldAlignmentView> {
  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentYear: 1,
        currentTurn: 1,
        startingYear: 1,
        intOrgAlignmentEnabled: 1,
        // Era-aware display names read this; omitting it silently falls back
        // to the modern preset and the Cold War reads "Germany" / "Russia".
        preset: 1,
      },
    }
  );

  const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
  const era = resolveAlignmentEra(year);
  const poleIds = polesForYear(year);
  const { poles, remainderLabel } = eraPoleVocabulary(year);
  // Names are era-aware: a 1953 world says West Germany and Soviet Union.
  const preset = resolvePresetIdFromGameState(gs);
  const base = {
    year,
    eraKey: era.key,
    joinGate: joinGateForPoleCount(poleIds.length),
    poles,
    // The Non-Aligned Movement is founded at Belgrade in 1961; before that the
    // same remainder is simply uncommitted.
    remainderLabel,
  };

  // Gate off: report the shape so the page can render a disabled state, but
  // never read the collection.
  if (!(await isIntOrgAlignmentEnabled(gs ?? {}))) {
    return { ...base, enabled: false, rows: [], crises: [] };
  }

  const col = await getCountryAlignmentsCollection(db);
  const [docs, memberships] = await Promise.all([
    col.find({}).toArray(),
    db
      .collection<OrganizationMembership>("organizationMemberships")
      .find({})
      .project<{ organizationId: string; countryId: CountryId }>({
        organizationId: 1,
        countryId: 1,
      })
      .toArray(),
  ]);

  const orgsByCountry = new Map<CountryId, string[]>();
  for (const m of memberships) {
    const list = orgsByCountry.get(m.countryId) ?? [];
    list.push(m.organizationId);
    orgsByCountry.set(m.countryId, list);
  }

  /** Poles reachable by the orgs this country belongs to, via era channels. */
  const polesOf = (orgIds: string[]): Set<AlignmentPoleId> => {
    const set = new Set<AlignmentPoleId>();
    for (const c of era.channels) {
      if (orgIds.includes(c.organizationId)) set.add(c.poleId);
    }
    return set;
  };

  const rows: LedgerRow[] = [];
  for (const doc of docs) {
    const orgIds = orgsByCountry.get(doc.entityId as CountryId) ?? [];
    const standing = projectNationStanding(doc, {
      era,
      poleIds,
      memberPoleIds: polesOf(orgIds),
      preset,
    });
    if (!standing) continue;
    rows.push({ ...standing, orgIds });
  }

  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.lead - a.lead ||
      a.name.localeCompare(b.name)
  );

  // Open flashpoints, with what each bloc has already put on the table.
  const crisesCol = await getAlignmentCrisesCollection(db);
  const openCrises = await crisesCol.find({ status: "open" }).sort({ closesTurn: 1 }).toArray();

  const crises: LedgerCrisis[] = openCrises.map((crisis) => ({
    id: crisis._id.toString(),
    targetEntityId: crisis.targetEntityId,
    targetName:
      COUNTRY_CONFIGS[crisis.targetEntityId as CountryId]?.name ??
      ROSTER_BY_KEY[crisis.targetEntityId]?.name ??
      crisis.targetEntityId,
    title: crisis.title,
    headline: crisis.headline,
    turnsRemaining: Math.max(0, crisis.closesTurn - (gs?.currentTurn ?? 0)),
    movementCap: CRISIS_TURN_CAP,
  }));

  return { ...base, enabled: true, rows, crises };
}
