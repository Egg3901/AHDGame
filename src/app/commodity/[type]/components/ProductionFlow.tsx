"use client";

import { useState } from "react";
import type { SectorFlow } from "../types";

interface ProductionFlowProps {
  suppliers: SectorFlow[];
  consumers: SectorFlow[];
}

export default function ProductionFlow({ suppliers, consumers }: ProductionFlowProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (suppliers.length === 0 && consumers.length === 0) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card mb-6 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-card-elevated/50 transition-colors"
      >
        <h2 className="text-lg font-bold text-foreground">Production Flow</h2>
        <svg
          className={`w-5 h-5 text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-6 pb-6 border-t border-card-border/50">
          <div className="grid sm:grid-cols-2 gap-6 pt-4">
            <div>
              <h3 className="text-sm font-bold text-foreground mb-1">Suppliers</h3>
              <p className="text-xs text-muted mb-3">Sectors that produce this commodity</p>
              {suppliers.length === 0 ? (
                <p className="text-sm text-muted">No sectors supply this commodity.</p>
              ) : (
                <div className="space-y-2">
                  {suppliers.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{s.label}</span>
                      <span className="text-success font-medium tabular-nums">
                        {(s.rate * 100).toFixed(0)}% of revenue
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-bold text-foreground mb-1">Consumers</h3>
              <p className="text-xs text-muted mb-3">
                Sectors that consume this commodity as input
              </p>
              {consumers.length === 0 ? (
                <p className="text-sm text-muted">No sectors demand this commodity.</p>
              ) : (
                <div className="space-y-2">
                  {consumers.map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{s.label}</span>
                      <span className="text-error font-medium tabular-nums">
                        {(s.rate * 100).toFixed(0)}% of revenue
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
