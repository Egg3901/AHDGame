import type { Bill, NPPVotePrediction, StateBill } from "@/lib/db/types";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { CrossPressureForceBar } from "@/components/CrossPressureForceBar";

/**
 * Server component — loads the most recent cross-pressure prediction this NPP
 * has on file and renders the Forecast card. Hidden when no prediction exists
 * (e.g. brand-new NPP with no bills voted yet).
 *
 * Forecast data is written by `processBillVoting` and `applyWhipVotesToBill`
 * (Phase 4); see `src/lib/turn/npp/crossPressure.ts` for force semantics.
 */
async function loadLatestPrediction(nppId: ObjectId): Promise<{
  prediction: NPPVotePrediction;
  bill:
    | Pick<Bill, "_id" | "title" | "status" | "currentChamber">
    | Pick<StateBill, "_id" | "title" | "status">;
} | null> {
  const db = await getDb();
  const prediction = await db
    .collection<NPPVotePrediction>("nppVotePredictions")
    .findOne({ nppId }, { sort: { computedAtTurn: -1, updatedAt: -1 } });
  if (!prediction) return null;

  const bill = prediction.billId
    ? await db
        .collection<Bill>("bills")
        .findOne(
          { _id: prediction.billId },
          { projection: { _id: 1, title: 1, status: 1, currentChamber: 1 } }
        )
    : prediction.stateBillId
      ? await db
          .collection<StateBill>("stateBills")
          .findOne({ _id: prediction.stateBillId }, { projection: { _id: 1, title: 1, status: 1 } })
      : null;
  if (!bill) return null;
  return { prediction, bill };
}

export async function NppForecastCard({ nppId }: { nppId: ObjectId }) {
  const data = await loadLatestPrediction(nppId);
  if (!data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
          Cross-pressure forecast
        </h2>
        <p className="text-sm text-zinc-400">
          No active vote prediction on file. The next bill this NPP votes on will populate the
          forecast with their ideology, whip, district, and donor pulls.
        </p>
      </div>
    );
  }
  const { prediction, bill } = data;
  const verdict = prediction.verdict;
  const verdictPill =
    verdict === "for"
      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
      : verdict === "against"
        ? "bg-red-500/15 border-red-500/40 text-red-300"
        : "bg-zinc-700/30 border-zinc-600 text-zinc-300";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
            Cross-pressure forecast · most recent vote
          </h2>
          <p className="mt-1 text-sm font-semibold">{bill.title}</p>
          <p className="text-[11px] text-zinc-500">
            Snapshot from turn {prediction.computedAtTurn}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${verdictPill}`}
        >
          Verdict: {verdict}
        </span>
      </div>

      <CrossPressureForceBar forces={prediction.forces} />

      <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400">
        <span className="font-semibold text-zinc-300">Donors:</span> {prediction.donorsLabel}
      </div>
    </div>
  );
}
