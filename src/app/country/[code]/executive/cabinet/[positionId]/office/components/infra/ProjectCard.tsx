"use client";

import { useState } from "react";
import type { ProjectView } from "../../useCabinetOffice";
import { BUILD_FUNDING } from "@/lib/constants/cabinetInfra";
import { Stat, InfraIcon, ConfirmDialog, fmtMoneyM } from "./infraUi";
import { ProgressBar } from "./ProgressBar";
// The tab above these cards carries the explanation; a note on every card would
// only repeat it. The lock still reaches here so the card's own buttons disable.
import { useActingLock } from "../ActingLock";

export function ProjectCard({
  project,
  basePath,
  canAct: canActProp,
  currencySymbol,
  regionName,
  busy,
  onAction,
}: {
  project: ProjectView;
  basePath: string;
  canAct: boolean;
  currencySymbol: string;
  regionName: string;
  busy: boolean;
  onAction: (method: "POST" | "DELETE", path: string, body?: unknown) => void;
}) {
  // An acting secretary reads this surface but does not move it.
  const actingLockReason = useActingLock("assets");
  const canAct = canActProp && !actingLockReason;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const isOperational = project.status === "operational";

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-gov-soft">
            <InfraIcon name={project.icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">{project.name}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  isOperational
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] text-gov-soft"
                }`}
              >
                {isOperational ? "Operational" : "Under construction"}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              <span>{regionName}</span>
            </div>
            {!isOperational && (
              <div className="mt-2">
                <ProgressBar pct={project.progressPct} />
                <div className="mt-1 flex justify-between text-[10px] text-muted">
                  <span>{project.progressPct}% built</span>
                  <span>≈ {project.turnsRemaining} turns left</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {isOperational && (
          <div className="grid grid-cols-2 gap-4 lg:w-[200px] lg:shrink-0">
            <Stat
              label="Output"
              value={project.effectiveOutput.toLocaleString("en-US")}
              tone="gov"
            />
            <Stat label="Upkeep" value={fmtMoneyM(currencySymbol, project.effectiveUpkeep)} />
          </div>
        )}
      </div>

      {/* Management row */}
      <div className="border-t border-card-border bg-card-muted p-4">
        {isOperational ? (
          <button
            disabled={!canAct || busy}
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] font-semibold text-error hover:bg-error/20 disabled:opacity-50"
          >
            Retire project
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="dossier-label mb-1.5 text-muted">Build funding</div>
              <div className="flex gap-1.5">
                {BUILD_FUNDING.map((f) => (
                  <button
                    key={f.id}
                    disabled={!canAct || busy}
                    onClick={() =>
                      onAction("POST", `${basePath}/${project._id}/funding`, { fundingLevel: f.id })
                    }
                    className={`rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50 ${
                      project.fundingLevel === f.id
                        ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] text-gov-soft"
                        : "border-card-border bg-card text-muted hover:text-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              disabled={!canAct || busy}
              onClick={() => setConfirmDelete(true)}
              className="self-end rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] font-semibold text-error hover:bg-error/20 disabled:opacity-50"
            >
              Cancel project
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={isOperational ? "Retire project" : "Cancel project"}
        confirmLabel={isOperational ? "Retire" : "Cancel project"}
        body={
          <>
            {isOperational ? "Retire" : "Cancel"}{" "}
            <span className="font-semibold text-foreground">{project.name}</span>?{" "}
            {isOperational
              ? "This frees its upkeep and removes its standing effect."
              : "Construction progress will be lost."}
          </>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onAction("DELETE", `${basePath}/${project._id}`);
        }}
      />
    </div>
  );
}
