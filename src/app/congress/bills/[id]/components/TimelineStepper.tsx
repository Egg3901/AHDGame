import type { BillDetail } from "../types";
import { getCountryConfig } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import {
  TIMELINE_STEPS,
  JP_TIMELINE_STEPS,
  JP_CABINET_TIMELINE_STEPS,
  TERMINAL_STATUSES,
  STATUS_LABELS,
} from "../billHelpers";

export function TimelineStepper({ bill }: { bill: BillDetail }) {
  // Resolve the country from the bill (or its stateId) so chamber STRUCTURE,
  // not per-country literals, drives the common timeline shapes.
  const countryId =
    bill.countryId ?? (bill.stateId ? inferCountryIdFromStateId(bill.stateId) : undefined);
  const preset = useActivePreset();
  const config = countryId ? getCountryConfig(countryId, preset) : null;
  // Single-chamber legislative loops (UK Commons, DE Bundestag, CN NPC, IE Dáil)
  // enact straight from the origin vote — no "Passed Origin" / second-chamber
  // step, and the vote label comes from the chamber's own name.
  // Era-aware: TR 1953 is unicameral (no Senato).
  const isUnicameral = !!config && !config.legislature.bicameral;

  // JP keeps bespoke handling: cabinet-originated bills and the Shūgiin 2/3
  // override path are structurally unique and not expressible as config shape.
  const isJP = bill.countryId === "JP";
  const isJPCabinetBill = isJP && bill.originChamber === "cabinet";
  const isLegislativeOnly = !isUnicameral && !isJP && !bill.requiresExecutiveAction;

  const unicameralSteps = config
    ? [
        { key: "proposed", label: "Proposed", dateField: "proposedAt" },
        {
          key: "active",
          label: `${config.legislature.lowerChamber.shortName ?? config.legislature.lowerChamber.name} Vote`,
          dateField: "votingStartedAt",
        },
        { key: "signed", label: "Signed / Enacted", dateField: "enactedAt" },
      ]
    : JP_TIMELINE_STEPS;
  const steps = isJPCabinetBill
    ? JP_CABINET_TIMELINE_STEPS
    : isUnicameral
      ? unicameralSteps
      : isJP || isLegislativeOnly
        ? JP_TIMELINE_STEPS
        : TIMELINE_STEPS;

  // Presidential veto/override path is US-shaped — bicameral with an executive
  // veto. Unicameral chambers enact on the origin vote; JP has its own override.
  const isOverridePath =
    !isUnicameral &&
    !isJP &&
    (bill.status === "veto_override" ||
      bill.status === "override_failed" ||
      (bill.status === "signed" && bill.presidentAction === "override"));

  // JP Shugiin 2/3-override path: Sangiin rejected a Shugiin-passed bill, so the
  // Shugiin gets a supermajority override attempt. A JP bill is on this path when
  // it's actively in override_shugiin, or when it later reached signed/failed
  // after a Sangiin rejection (otherChamber votes against > for).
  const jpSangiinRejected =
    isJP &&
    bill.passedOriginAt != null &&
    (bill.otherChamberVotesAgainst ?? 0) > (bill.otherChamberVotesFor ?? 0);
  const isJPOverridePath =
    isJP &&
    (bill.status === "override_shugiin" ||
      ((bill.status === "signed" || bill.status === "failed") && jpSangiinRejected));

  const statusOrder = isJPCabinetBill
    ? ["proposed", "cabinet_review", "active", "active_other", "signed"]
    : isUnicameral
      ? ["proposed", "active", "signed"]
      : isJP || isLegislativeOnly
        ? ["proposed", "active", "passed_origin", "active_other", "signed"]
        : ["proposed", "active", "passed_origin", "active_other", "enrolled", "signed"];
  const currentIdx = statusOrder.indexOf(bill.status);
  // Override paths treat the last pre-override step as completed:
  // US → "enrolled" (index 4); JP → "active_other" (Sangiin vote completed with rejection)
  const effectiveIdx = isOverridePath
    ? 4
    : isJPOverridePath
      ? statusOrder.indexOf("active_other")
      : currentIdx;
  const isTerminal = TERMINAL_STATUSES.includes(bill.status);

  // For the normal signed path (no override), mark "signed" step as done
  const isNormalSigned =
    bill.status === "signed" && bill.presidentAction !== "override" && !isJPOverridePath;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-1">
      <h3 className="text-sm font-semibold mb-4">Legislative Timeline</h3>
      <div className="relative">
        {steps.map((step, i) => {
          const date = bill[step.dateField as keyof BillDetail] as string | null;

          // On override paths, skip the "signed" step — terminal outcome is rendered
          // by the override UI below (Enacted (Override) / Veto Sustained / Override Failed).
          if ((isOverridePath || isJPOverridePath) && step.key === "signed") return null;

          const isDone =
            i < effectiveIdx ||
            (isNormalSigned && step.key === "signed") ||
            // On JP override, the Sangiin (active_other) vote completed (with rejection) — mark done.
            (isJPOverridePath && step.key === "active_other") ||
            (i === effectiveIdx &&
              !isTerminal &&
              bill.status !== "active" &&
              bill.status !== "active_other" &&
              !isOverridePath &&
              !isJPOverridePath);
          const isCurrent =
            !isOverridePath &&
            !isJPOverridePath &&
            statusOrder[currentIdx] === step.key &&
            !isTerminal;
          const isFuture = !isDone && !isCurrent;

          return (
            <div key={step.key} className="flex items-start gap-3 pb-4 last:pb-0 relative">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div
                  className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${isDone ? "bg-emerald-500/50" : "bg-card-border"}`}
                />
              )}
              {/* Dot */}
              <div
                className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                  isDone
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                    : isCurrent
                      ? "border-yellow-400 bg-yellow-400/10 text-yellow-400 animate-pulse"
                      : "border-card-border bg-card text-muted/40"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <div className={`flex-1 pt-0.5 ${isFuture && !isCurrent ? "opacity-40" : ""}`}>
                <p
                  className={`text-xs font-medium ${isCurrent ? "text-yellow-400" : isDone ? "text-foreground" : "text-muted"}`}
                >
                  {step.label}
                </p>
                {date && (
                  <p className="text-[10px] text-muted mt-0.5">{new Date(date).toLocaleString()}</p>
                )}
              </div>
            </div>
          );
        })}

        {/* Terminal states (failed / withdrawn / vetoed without override) */}
        {isTerminal && !isOverridePath && !isJPOverridePath && (
          <div className="flex items-start gap-3 pb-0">
            <div
              className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                bill.status === "failed" || bill.status === "vetoed"
                  ? "border-error bg-error/20 text-error"
                  : "border-card-border bg-card-elevated text-muted"
              }`}
            >
              ✗
            </div>
            <div className="flex-1 pt-0.5">
              <p
                className={`text-xs font-medium ${bill.status === "failed" || bill.status === "vetoed" ? "text-error" : "text-muted"}`}
              >
                {STATUS_LABELS[bill.status]}
              </p>
              {(bill.failedAt ?? bill.enactedAt) && (
                <p className="text-[10px] text-muted mt-0.5">
                  {new Date((bill.failedAt ?? bill.enactedAt)!).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Override path steps (shown after "Sent to President" when vetoed + override attempted) */}
        {isOverridePath && (
          <>
            {/* Vetoed step — always shown as a red completed/passed step on the override path */}
            <div className="flex items-start gap-3 pb-4 relative">
              <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-error/40" />
              <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-error bg-error/20 text-error">
                ✗
              </div>
              <div className="flex-1 pt-0.5">
                <p className="text-xs font-medium text-error">Vetoed</p>
                {bill.failedAt && (
                  <p className="text-[10px] text-muted mt-0.5">
                    {new Date(bill.failedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Override Vote step */}
            {(() => {
              const isActive = bill.status === "veto_override";
              const isPast =
                bill.status === "override_failed" ||
                (bill.status === "signed" && bill.presidentAction === "override");
              const isFuture = !isActive && !isPast;
              return (
                <div className="flex items-start gap-3 pb-4 relative">
                  <div
                    className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${isPast ? "bg-amber-500/40" : "bg-card-border"}`}
                  />
                  <div
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                      isPast
                        ? "border-amber-500 bg-amber-500/20 text-amber-400"
                        : isActive
                          ? "border-amber-400 bg-amber-400/10 text-amber-400 animate-pulse"
                          : "border-card-border bg-card text-muted/40"
                    }`}
                  >
                    {isPast ? "✓" : "○"}
                  </div>
                  <div className={`flex-1 pt-0.5 ${isFuture ? "opacity-40" : ""}`}>
                    <p
                      className={`text-xs font-medium ${isActive ? "text-amber-400" : isPast ? "text-foreground" : "text-muted"}`}
                    >
                      Override Vote
                    </p>
                    {bill.overrideVotingEndsAt && isActive && (
                      <p className="text-[10px] text-muted mt-0.5">
                        Ends {new Date(bill.overrideVotingEndsAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Veto Sustained — terminal red step shown only when override_failed */}
            {bill.status === "override_failed" && (
              <div className="flex items-start gap-3 pb-0">
                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-error bg-error/20 text-error">
                  ✗
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-xs font-medium text-error">Veto Sustained</p>
                  {bill.overrideFailedAt && (
                    <p className="text-[10px] text-muted mt-0.5">
                      {new Date(bill.overrideFailedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Override Enacted — shown when bill is signed via override */}
            {bill.status === "signed" && bill.presidentAction === "override" && (
              <div className="flex items-start gap-3 pb-0">
                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-emerald-500 bg-emerald-500/20 text-emerald-400">
                  ✓
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-xs font-medium text-emerald-400">Enacted (Override)</p>
                  {bill.overrideEnactedAt && (
                    <p className="text-[10px] text-muted mt-0.5">
                      {new Date(bill.overrideEnactedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/*
          JP Shugiin override path: Sangiin rejected a Shugiin-passed bill, so the
          Shugiin gets a 2/3 supermajority override attempt. Unlike the US path, the
          JP lifecycle reuses the main votingStartedAt/votingEndsAt fields for the
          override vote (see jpBillLifecycle.ts).
        */}
        {isJPOverridePath && (
          <>
            {/* Sangiin Rejected — red step marking the rejection that triggered the override */}
            <div className="flex items-start gap-3 pb-4 relative">
              <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-error/40" />
              <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-error bg-error/20 text-error">
                ✗
              </div>
              <div className="flex-1 pt-0.5">
                <p className="text-xs font-medium text-error">Sangiin Rejected</p>
                {bill.otherChamberVotingEndsAt && (
                  <p className="text-[10px] text-muted mt-0.5">
                    {new Date(bill.otherChamberVotingEndsAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Shugiin Override Vote — 2/3 supermajority required */}
            {(() => {
              const isActive = bill.status === "override_shugiin";
              const isPast = bill.status === "signed" || bill.status === "failed";
              const isFuture = !isActive && !isPast;
              return (
                <div className="flex items-start gap-3 pb-4 relative">
                  <div
                    className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${isPast ? "bg-amber-500/40" : "bg-card-border"}`}
                  />
                  <div
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                      isPast
                        ? "border-amber-500 bg-amber-500/20 text-amber-400"
                        : isActive
                          ? "border-amber-400 bg-amber-400/10 text-amber-400 animate-pulse"
                          : "border-card-border bg-card text-muted/40"
                    }`}
                  >
                    {isPast ? "✓" : "○"}
                  </div>
                  <div className={`flex-1 pt-0.5 ${isFuture ? "opacity-40" : ""}`}>
                    <p
                      className={`text-xs font-medium ${isActive ? "text-amber-400" : isPast ? "text-foreground" : "text-muted"}`}
                    >
                      Shugiin Override Vote (2/3)
                    </p>
                    {bill.votingEndsAt && isActive && (
                      <p className="text-[10px] text-muted mt-0.5">
                        Ends {new Date(bill.votingEndsAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Override Failed — terminal red step */}
            {bill.status === "failed" && (
              <div className="flex items-start gap-3 pb-0">
                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-error bg-error/20 text-error">
                  ✗
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-xs font-medium text-error">Override Failed</p>
                  {bill.failedAt && (
                    <p className="text-[10px] text-muted mt-0.5">
                      {new Date(bill.failedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Enacted via override — terminal green step */}
            {bill.status === "signed" && (
              <div className="flex items-start gap-3 pb-0">
                <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold border-emerald-500 bg-emerald-500/20 text-emerald-400">
                  ✓
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-xs font-medium text-emerald-400">Enacted (Override)</p>
                  {bill.enactedAt && (
                    <p className="text-[10px] text-muted mt-0.5">
                      {new Date(bill.enactedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
