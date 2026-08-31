"use client";

/**
 * Seat allocation for the Blend detail view.
 *
 * One block is one seat, grouped into contiguous party runs, with the run
 * labels lining up underneath. The design chose blocks over a hemicycle on
 * purpose: a small chamber reads badly as an arc, and a block per seat is
 * countable.
 *
 * The UK seats a chamber of opposing benches rather than a bloc bar, so a
 * Westminster race gets the bench layout instead.
 */

import type { BlendDetailModel } from "@/lib/elections/blendDetailViewModel";

interface BlendSeatAllocationProps {
  model: BlendDetailModel;
  regionName: string;
}

export function BlendSeatAllocation({ model, regionName }: BlendSeatAllocationProps) {
  if (!model.isSeatRace) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted">
          {model.allocLabel} · {regionName}
        </span>
        <span className="text-[11px] text-muted">{model.hemiNote}</span>
      </div>

      {model.isBench && model.bench ? (
        <BenchChamber bench={model.bench} model={model} />
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-[3px]">
            {model.blockRows.map((row) => (
              <div key={row.id} className="flex gap-[3px]">
                {row.cells.map((cell, i) => (
                  <div
                    key={`${row.id}-${i}`}
                    title={cell.title}
                    className="min-w-0 flex-1 rounded-[3px]"
                    style={{ height: model.blockHeight, background: cell.color }}
                  />
                ))}
                {Array.from({ length: row.pad }, (_, i) => (
                  <div
                    key={`${row.id}-pad-${i}`}
                    className="min-w-0 flex-1"
                    style={{ height: model.blockHeight }}
                    aria-hidden
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Run labels only line up with the blocks on a single row. */}
          {model.blocksSingleRow && (
            <div className="mt-1.5 flex gap-[3px]">
              {model.blockRuns.map((run, i) => (
                <div
                  key={`${run.partyAbbr}-${i}`}
                  className="flex min-w-0 flex-col items-center gap-[3px]"
                  style={{ width: `${run.widthPct}%` }}
                >
                  <div
                    className="h-[2px] w-full rounded-sm opacity-60"
                    style={{ background: run.color }}
                  />
                  <span
                    className="max-w-full overflow-hidden whitespace-nowrap text-[11px] font-extrabold tracking-wide"
                    style={{ color: run.color }}
                  >
                    {run.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5 text-[11px] text-muted">{model.blockNote}</div>
        </>
      )}
    </div>
  );
}

function BenchChamber({
  bench,
  model,
}: {
  bench: NonNullable<BlendDetailModel["bench"]>;
  model: BlendDetailModel;
}) {
  const height = 200;
  return (
    <>
      <div className="mb-1.5 mt-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
          {bench.govLabel} · {bench.govCount}
        </span>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
          {model.hemiNote}
        </span>
      </div>

      <div className="relative w-full" style={{ height }}>
        {/* Speaker's chair, at the head of the chamber */}
        <div
          title="Speaker of the House"
          className="absolute h-[34px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-t-[5px] rounded-b-[3px] border-[1.5px] border-muted bg-card-elevated"
          style={{ left: "5.5%", top: "49%" }}
        />
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 text-[8px] font-extrabold text-muted"
          style={{ left: "5.5%", top: "49%" }}
        >
          SPK
        </div>
        {/* Table of the House, between the despatch boxes */}
        <div
          className="absolute h-[11px] -translate-y-1/2 rounded-[3px] border border-card-border bg-card-muted"
          style={{ left: "14%", right: "6%", top: "49%" }}
        />
        <div
          className="absolute h-4 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-card-border"
          style={{ left: "20%", top: "49%" }}
        />
        <div
          className="absolute h-4 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-card-border"
          style={{ left: "26%", top: "49%" }}
        />

        {[...bench.gov, ...bench.opp].map((seat, i) => (
          <div
            key={i}
            title={seat.title}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-sm"
            style={{
              left: `${seat.xPct}%`,
              top: `${seat.yPct}%`,
              width: seat.size,
              height: seat.size,
              background: seat.color,
              opacity: seat.opacity,
            }}
          />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
          {bench.oppLabel} · {bench.oppCount}
        </span>
        <span className="text-[11px] text-muted">
          {bench.majorityNote} · front bench nearest the floor
        </span>
      </div>
    </>
  );
}
