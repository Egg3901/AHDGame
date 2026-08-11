"use client";

import { useState } from "react";
import Link from "next/link";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { formatUnits } from "../lib/helpers";
import type { CorpVolume, SyntheticDemandSource } from "../types";

const PAGE_SIZE = 10;

interface TopProducersConsumersProps {
  topProducers: CorpVolume[];
  topConsumers: CorpVolume[];
  syntheticDemandSources: SyntheticDemandSource[];
  unit: string;
  commodity: string;
  consumerNote?: string;
  marketLabel?: string;
}

function Pagination({
  page,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-card-border">
      <span className="text-xs text-muted tabular-nums">
        {start}–{end} of {total}
      </span>
      <div className="flex gap-1">
        <button
          onClick={onPrev}
          disabled={page === 1}
          className="px-2 py-1 text-xs rounded-md border border-card-border text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ‹ Prev
        </button>
        <button
          onClick={onNext}
          disabled={page === totalPages}
          className="px-2 py-1 text-xs rounded-md border border-card-border text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

export default function TopProducersConsumers({
  topProducers,
  topConsumers,
  syntheticDemandSources,
  unit,
  commodity,
  consumerNote,
  marketLabel,
}: TopProducersConsumersProps) {
  const [producerPage, setProducerPage] = useState(1);
  const [consumerPage, setConsumerPage] = useState(1);

  if (topProducers.length === 0 && topConsumers.length === 0) return null;

  const pagedProducers = topProducers.slice(
    (producerPage - 1) * PAGE_SIZE,
    producerPage * PAGE_SIZE
  );
  const pagedConsumers = topConsumers.slice(
    (consumerPage - 1) * PAGE_SIZE,
    consumerPage * PAGE_SIZE
  );

  return (
    <div className="grid sm:grid-cols-2 gap-6 mb-6">
      {topProducers.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-1">Top Producers</h2>
          <p className="text-xs text-muted mb-3">
            Largest corporations by output volume
            {marketLabel ? ` in the ${marketLabel.toLowerCase()}` : ""}
          </p>
          <div className="space-y-2">
            {pagedProducers.map((c, i) => (
              <Link
                key={c.corpId}
                href={`/corporation/${c.sequentialId ?? c.corpId}`}
                className="flex items-center justify-between text-sm hover:bg-card-elevated/50 -mx-2 px-2 py-1 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted tabular-nums font-mono w-4 text-right shrink-0">
                    {(producerPage - 1) * PAGE_SIZE + i + 1}
                  </span>
                  <CorporationLogo
                    logoUrl={c.logoUrl}
                    name={c.name}
                    size="h-5 w-5"
                    className="rounded border border-card-border bg-card-elevated"
                  />
                  <span className="text-foreground font-medium truncate">{c.name}</span>
                  {c.typeLabel && (
                    <span className="text-[10px] text-muted shrink-0">{c.typeLabel}</span>
                  )}
                </div>
                <span className="text-success font-medium tabular-nums shrink-0 ml-2">
                  {formatUnits(c.units, unit)}
                </span>
              </Link>
            ))}
          </div>
          <Pagination
            page={producerPage}
            total={topProducers.length}
            onPrev={() => setProducerPage((p) => Math.max(1, p - 1))}
            onNext={() =>
              setProducerPage((p) => Math.min(Math.ceil(topProducers.length / PAGE_SIZE), p + 1))
            }
          />
        </div>
      )}

      {topConsumers.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-1">Top Consumers</h2>
          <p className="text-xs text-muted mb-3">
            Largest corporations by input demand
            {commodity === "advertising" && " (includes marketing spend)"}
            {marketLabel ? ` in the ${marketLabel.toLowerCase()}` : ""}
          </p>
          {consumerNote && <p className="text-xs text-muted mb-3">{consumerNote}</p>}
          <div className="space-y-2">
            {pagedConsumers.map((c, i) => (
              <Link
                key={c.corpId}
                href={`/corporation/${c.sequentialId ?? c.corpId}`}
                className="flex items-center justify-between text-sm hover:bg-card-elevated/50 -mx-2 px-2 py-1 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted tabular-nums font-mono w-4 text-right shrink-0">
                    {(consumerPage - 1) * PAGE_SIZE + i + 1}
                  </span>
                  <CorporationLogo
                    logoUrl={c.logoUrl}
                    name={c.name}
                    size="h-5 w-5"
                    className="rounded border border-card-border bg-card-elevated"
                  />
                  <span className="text-foreground font-medium truncate">{c.name}</span>
                  {c.typeLabel && (
                    <span className="text-[10px] text-muted shrink-0">{c.typeLabel}</span>
                  )}
                </div>
                <span className="text-error font-medium tabular-nums shrink-0 ml-2">
                  {formatUnits(c.units, unit)}
                </span>
              </Link>
            ))}
            {consumerPage === Math.ceil(topConsumers.length / PAGE_SIZE) &&
              syntheticDemandSources?.map((source) => (
                <div
                  key={source.name}
                  className="flex items-center justify-between text-sm -mx-2 px-2 py-1 rounded-lg bg-card-elevated/30 border border-dashed border-card-border"
                  title={source.description}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted tabular-nums font-mono w-4 text-right shrink-0">
                      ⚙
                    </span>
                    <span className="text-muted font-medium truncate">{source.name}</span>
                    <span className="text-[10px] text-muted shrink-0">System</span>
                  </div>
                  <span className="text-muted font-medium tabular-nums shrink-0 ml-2">
                    {formatUnits(source.units, unit)}
                  </span>
                </div>
              ))}
          </div>
          <Pagination
            page={consumerPage}
            total={topConsumers.length}
            onPrev={() => setConsumerPage((p) => Math.max(1, p - 1))}
            onNext={() =>
              setConsumerPage((p) => Math.min(Math.ceil(topConsumers.length / PAGE_SIZE), p + 1))
            }
          />
        </div>
      )}
    </div>
  );
}
