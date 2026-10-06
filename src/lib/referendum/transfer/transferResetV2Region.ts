import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { ResetLawOpeningBoard } from "@/lib/resetLegislation/rules/openingBoard";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import {
  transferResetV2FiscalToIreland,
  transferResetV2LawToIreland,
  transferResetV2MetricToIreland,
} from "./rules/resetV2Transfer";

/** Move Northern Ireland's world-bound v2 regional boards into Ireland. */
export async function transferResetV2RegionToIreland(db: Db, regionId: string): Promise<void> {
  if (regionId !== "NIR") return;
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        resetWorldId: 1,
        metricsSystemVersion: 1,
        legislationSystemVersion: 1,
        cabinetSystemVersion: 1,
        resetVersionSeeds: 1,
      },
    }
  );
  if (!gameState?.resetWorldId) return;
  const ukVersions = resetSystemVersionsForCountry(gameState, RESET_V2_READY, "UK");
  const ieVersions = resetSystemVersionsForCountry(gameState, RESET_V2_READY, "IE");
  if (ukVersions.metrics !== "v2" || ieVersions.metrics !== "v2") return;

  const worldId = gameState.resetWorldId;
  const sourceId = `UK:${regionId}`;
  const targetId = `IE:${regionId}`;
  const metrics = db.collection<ResetMetricSnapshot>("resetMetricSnapshots");
  const laws = db.collection<ResetLawOpeningBoard>("resetLawOpeningBoards");
  const regionalFinance = db.collection<ResetRegionalOpeningBoard>("resetRegionalOpeningBoards");
  const legislationReady = ukVersions.legislation === "v2" && ieVersions.legislation === "v2";
  const [sourceMetric, sourceLaw, sourceFiscal, targetMetric, targetLaw, targetFiscal] =
    await Promise.all([
      metrics.findOne({ _id: sourceId, worldId }),
      legislationReady ? laws.findOne({ _id: sourceId, worldId }) : Promise.resolve(null),
      legislationReady
        ? regionalFinance.findOne({ _id: sourceId, worldId })
        : Promise.resolve(null),
      metrics.findOne({ _id: targetId, worldId }),
      legislationReady ? laws.findOne({ _id: targetId, worldId }) : Promise.resolve(null),
      legislationReady
        ? regionalFinance.findOne({ _id: targetId, worldId })
        : Promise.resolve(null),
    ]);
  const metricInput = sourceMetric ?? targetMetric;
  const lawInput = sourceLaw ?? targetLaw;
  const fiscalInput = sourceFiscal ?? targetFiscal;
  if (!metricInput) throw new Error(`${regionId} v2 metric board is missing before reunification`);
  if (legislationReady && (!lawInput || !fiscalInput)) {
    throw new Error(`${regionId} v2 law or fiscal board is missing before reunification`);
  }

  await metrics.replaceOne(
    { _id: targetId },
    transferResetV2MetricToIreland(metricInput, regionId),
    { upsert: true }
  );

  if (legislationReady && lawInput && fiscalInput) {
    await Promise.all([
      laws.replaceOne({ _id: targetId }, transferResetV2LawToIreland(lawInput, regionId), {
        upsert: true,
      }),
      regionalFinance.replaceOne(
        { _id: targetId },
        transferResetV2FiscalToIreland(fiscalInput, regionId),
        { upsert: true }
      ),
    ]);
  }

  // Delete sources only after every applicable replacement exists. A retry can
  // use either side, so an interruption between these idempotent deletes is safe.
  await Promise.all([
    metrics.deleteOne({ _id: sourceId, worldId }),
    ...(legislationReady
      ? [
          laws.deleteOne({ _id: sourceId, worldId }),
          regionalFinance.deleteOne({ _id: sourceId, worldId }),
        ]
      : []),
  ]);
}
