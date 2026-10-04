/**
 * Legacy settlement finances show the latest overdraft and successor arrears.
 * loadLegacyServiceSnapshots exposes public fiscal consequences only after the
 * matching federation application has committed.
 */
import type { Db } from "mongodb";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import type { FederationLegacyServiceTurn } from "./legacyServiceTurn";
import type { FederationContinuingServiceTurn } from "./continuingServiceTurn";
import type { FederationSettlementApplicationRecord } from "./runtimeEntities";

export interface LegacyServiceSnapshot {
  servicingKind?: "continuing-state";
  issuerOwnShareMinor?: number;
  sourceCountryId: string;
  sourceName: string;
  turn: number;
  creditorDueMinor: number;
  bridgeOutstandingMinor: number;
  administrationCashAfterMinor: number;
  successors: { entityId: string; name: string; contributionMinor: number; arrearsMinor: number }[];
}

export async function loadLegacyServiceSnapshots(
  db: Db,
  preset: string
): Promise<LegacyServiceSnapshot[]> {
  if (preset !== "1991-default") return [];
  const applications = await db
    .collection<FederationSettlementApplicationRecord>("federationSettlementApplications")
    .find({ presetId: preset, status: "applied" }, { projection: { _id: 1, sourceEntityId: 1 } })
    .toArray();
  if (!applications.length) return [];
  const latest = await db
    .collection<FederationLegacyServiceTurn>("federationLegacyServiceTurns")
    .aggregate<{
      _id: string;
      turn: number;
      creditorDueMinor: number;
      bridgeOutstandingMinor: number;
      administrationCashAfterMinor: number;
      contributions: Record<string, number>;
      arrears: Record<string, number>;
    }>([
      { $match: { applicationId: { $in: applications.map((row) => row._id) } } },
      { $sort: { applicationId: 1, turn: -1 } },
      {
        $group: {
          _id: "$applicationId",
          turn: { $first: "$turn" },
          creditorDueMinor: { $first: "$creditorDueMinor" },
          bridgeOutstandingMinor: { $first: "$bridgeOutstandingMinor" },
          administrationCashAfterMinor: { $first: "$administrationCashAfterMinor" },
          contributions: { $first: "$successorContributionsMinor" },
          arrears: { $first: "$successorArrearsMinor" },
        },
      },
    ])
    .toArray();
  const names = new Map(
    getWorldEntityPresetManifest(preset).entries.map((entry) => [entry.entityId, entry.displayName])
  );
  const sources = new Map(applications.map((row) => [row._id, row.sourceEntityId]));
  const continuing = await db
    .collection<FederationContinuingServiceTurn>("federationContinuingServiceTurns")
    .aggregate<{
      _id: string;
      turn: number;
      creditorDueMinor: number;
      issuerOwnShareMinor: number;
      issuerCashAfterContributionsMinor: number;
      contributions: Record<string, number>;
      arrears: Record<string, number>;
    }>([
      { $match: { applicationId: { $in: applications.map((row) => row._id) } } },
      { $sort: { applicationId: 1, turn: -1 } },
      {
        $group: {
          _id: "$applicationId",
          turn: { $first: "$turn" },
          creditorDueMinor: { $first: "$creditorDueMinor" },
          issuerOwnShareMinor: { $first: "$issuerOwnShareMinor" },
          issuerCashAfterContributionsMinor: { $first: "$issuerCashAfterContributionsMinor" },
          contributions: { $first: "$successorContributionsMinor" },
          arrears: { $first: "$successorArrearsMinor" },
        },
      },
    ])
    .toArray();
  return [
    ...latest.map((row) => ({ ...row, servicingKind: undefined, issuerOwnShareMinor: undefined })),
    ...continuing.map((row) => ({
      ...row,
      servicingKind: "continuing-state" as const,
      bridgeOutstandingMinor: 0,
      administrationCashAfterMinor: row.issuerCashAfterContributionsMinor,
    })),
  ]
    .map((row) => ({
      ...(row.servicingKind
        ? { servicingKind: row.servicingKind, issuerOwnShareMinor: row.issuerOwnShareMinor }
        : {}),
      sourceCountryId: sources.get(row._id)!,
      sourceName: names.get(sources.get(row._id)!) ?? sources.get(row._id)!,
      turn: row.turn,
      creditorDueMinor: row.creditorDueMinor,
      bridgeOutstandingMinor: row.bridgeOutstandingMinor,
      administrationCashAfterMinor: row.administrationCashAfterMinor,
      successors: [...new Set([...Object.keys(row.contributions), ...Object.keys(row.arrears)])]
        .sort()
        .map((entityId) => ({
          entityId,
          name: names.get(entityId) ?? entityId,
          contributionMinor: row.contributions[entityId] ?? 0,
          arrearsMinor: row.arrears[entityId] ?? 0,
        })),
    }))
    .sort((a, b) => a.sourceCountryId.localeCompare(b.sourceCountryId));
}
