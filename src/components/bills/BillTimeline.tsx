"use client";

import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { LocalTime } from "@/components/time/LocalTime";

const NATIONAL_TIMELINE_NODES = ["Proposed", "Voted", "Passed", "2nd Chamber", "Enacted"] as const;
const JP_CABINET_TIMELINE_NODES = ["Proposed", "Cabinet", "Shugiin", "Sangiin", "Enacted"] as const;
/** Single-chamber national legislature (UK Commons, DE Bundestag, CN NPC, IE Dáil) — enacts straight from the origin vote. */
const UNICAMERAL_TIMELINE_NODES = ["Proposed", "Voted", "Enacted"] as const;

/** Subnational (state / devolved) legislature — no second chamber step */
function stateTimelineNodes(executiveLabel: string) {
  return ["Proposed", "Chamber", executiveLabel, "Law"] as const;
}

/** Timeline for a single-chamber national bill — no Passed/2nd-chamber steps. */
function getUnicameralTimelineState(status: string): {
  filledUpTo: number;
  activeNode: number | null;
  failed: boolean;
} {
  switch (status) {
    case "proposed":
      return { filledUpTo: 0, activeNode: null, failed: false };
    case "active":
      return { filledUpTo: 0, activeNode: 1, failed: false };
    case "signed":
      return { filledUpTo: 2, activeNode: null, failed: false };
    case "failed":
      return { filledUpTo: 1, activeNode: null, failed: true };
    case "withdrawn":
      return { filledUpTo: 0, activeNode: null, failed: true };
    default:
      return { filledUpTo: 0, activeNode: null, failed: false };
  }
}

function getNationalTimelineState(status: string): {
  filledUpTo: number;
  activeNode: number | null;
  failed: boolean;
} {
  switch (status) {
    case "proposed":
      return { filledUpTo: 0, activeNode: null, failed: false };
    case "active":
      return { filledUpTo: 0, activeNode: 1, failed: false };
    case "cabinet_review":
      return { filledUpTo: 0, activeNode: 1, failed: false };
    case "passed_origin":
      return { filledUpTo: 2, activeNode: null, failed: false };
    case "active_other":
    // Both chambers at once: the bill is past proposal and sitting in the chamber
    // stage, so it reads as that step rather than inventing a node for it.
    case "active_both":
      return { filledUpTo: 2, activeNode: 3, failed: false };
    case "override_shugiin":
      return { filledUpTo: 3, activeNode: 3, failed: false };
    case "enrolled":
      return { filledUpTo: 3, activeNode: 4, failed: false };
    case "signed":
      return { filledUpTo: 4, activeNode: null, failed: false };
    case "vetoed":
      return { filledUpTo: 3, activeNode: null, failed: true };
    case "failed":
      return { filledUpTo: 1, activeNode: null, failed: true };
    case "withdrawn":
      return { filledUpTo: 0, activeNode: null, failed: true };
    case "veto_override":
      return { filledUpTo: 2, activeNode: 2, failed: false };
    case "override_failed":
      return { filledUpTo: 2, activeNode: null, failed: true };
    default:
      return { filledUpTo: 0, activeNode: null, failed: false };
  }
}

function getJPCabinetTimelineState(status: string): {
  filledUpTo: number;
  activeNode: number | null;
  failed: boolean;
} {
  switch (status) {
    case "cabinet_review":
      return { filledUpTo: 0, activeNode: 1, failed: false };
    case "active":
      return { filledUpTo: 1, activeNode: 2, failed: false };
    case "active_other":
    // Both chambers at once: the bill is past proposal and sitting in the chamber
    // stage, so it reads as that step rather than inventing a node for it.
    case "active_both":
      return { filledUpTo: 2, activeNode: 3, failed: false };
    case "override_shugiin":
      // Cabinet-origin overrides return to the Shugiin after a completed Sangiin rejection.
      return { filledUpTo: 3, activeNode: 2, failed: false };
    case "signed":
      return { filledUpTo: 4, activeNode: null, failed: false };
    case "failed":
    case "withdrawn":
      return { filledUpTo: 1, activeNode: null, failed: true };
    default:
      return getNationalTimelineState(status);
  }
}

/** Timeline for raw StateBillStatus strings */
function getStateTimelineState(status: string): {
  filledUpTo: number;
  activeNode: number | null;
  failed: boolean;
} {
  switch (status) {
    case "proposed":
      return { filledUpTo: 0, activeNode: null, failed: false };
    case "active":
      return { filledUpTo: 0, activeNode: 1, failed: false };
    case "passed":
      return { filledUpTo: 1, activeNode: 2, failed: false };
    case "veto_override":
      return { filledUpTo: 2, activeNode: 2, failed: false };
    case "signed":
    case "enacted":
      return { filledUpTo: 3, activeNode: null, failed: false };
    case "vetoed":
      return { filledUpTo: 2, activeNode: null, failed: true };
    case "override_failed":
      return { filledUpTo: 2, activeNode: null, failed: true };
    case "failed":
      return { filledUpTo: 0, activeNode: 1, failed: true };
    default:
      return { filledUpTo: 0, activeNode: null, failed: false };
  }
}

export function BillTimeline({
  status,
  originChamber,
  proposedAt,
  votingEndsAt,
  variant = "national",
  countryId,
  stateStatus,
  stateExecutiveLabel = "Governor",
}: {
  status: string;
  originChamber: string;
  proposedAt: string;
  votingEndsAt: string | null;
  /** Use state timeline labels and steps for subnational bills */
  variant?: "national" | "state";
  /** National bill's country — drives unicameral (single-chamber) timeline shape. */
  countryId?: CountryId;
  /** Raw state bill status — required when variant is `state` */
  stateStatus?: string;
  /** Third timeline step for state bills (e.g. First Minister, Governor, Minister-President) */
  stateExecutiveLabel?: string;
}) {
  // Config-driven: a single-chamber national legislature (UK/DE/CN/IE) enacts
  // straight from the origin vote — no "Passed" / "2nd Chamber" steps.
  // Era-aware: TR 1953 is unicameral (no Senato).
  const preset = useActivePreset();
  const isUnicameralNational =
    variant === "national" &&
    originChamber !== "cabinet" &&
    !!countryId &&
    !getCountryConfig(countryId, preset).legislature.bicameral;
  const nodes =
    variant === "state"
      ? stateTimelineNodes(stateExecutiveLabel)
      : originChamber === "cabinet"
        ? JP_CABINET_TIMELINE_NODES
        : isUnicameralNational
          ? UNICAMERAL_TIMELINE_NODES
          : NATIONAL_TIMELINE_NODES;
  const { filledUpTo, activeNode, failed } =
    variant === "state" && stateStatus != null && stateStatus !== ""
      ? getStateTimelineState(stateStatus)
      : originChamber === "cabinet"
        ? getJPCabinetTimelineState(status)
        : isUnicameralNational
          ? getUnicameralTimelineState(status)
          : getNationalTimelineState(status);

  const isVoting =
    status === "cabinet_review" ||
    status === "active" ||
    status === "active_other" ||
    status === "active_both" ||
    status === "override_shugiin" ||
    (variant === "state" && (stateStatus === "active" || stateStatus === "veto_override"));

  const isSigned = status === "signed";

  const failedNote =
    variant === "state"
      ? stateStatus === "vetoed"
        ? `Vetoed by ${stateExecutiveLabel}`
        : stateStatus === "failed"
          ? "Failed in chamber"
          : stateStatus === "override_failed"
            ? "Override failed"
            : null
      : status === "withdrawn"
        ? `Withdrawn (${originChamber})`
        : status === "failed"
          ? originChamber === "cabinet"
            ? "Failed"
            : isUnicameralNational
              ? "Failed in chamber"
              : `Failed in ${originChamber === "senate" ? "Senate" : "House"}`
          : status === "vetoed"
            ? "Vetoed by President"
            : null;

  const maxIdx = nodes.length - 1;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        {nodes.map((nodeLabel, i) => {
          const isFilled = i <= filledUpTo;
          const isActive = i === activeNode;
          const isFailedNode =
            failed &&
            ((variant === "state" && stateStatus === "vetoed" && i === maxIdx) ||
              (variant === "state" && stateStatus === "failed" && i === 1) ||
              (variant === "state" && stateStatus === "override_failed" && i === 2) ||
              (variant !== "state" && status === "vetoed" && i === 4) ||
              (variant !== "state" && status === "failed" && i === 1) ||
              (variant !== "state" && status === "withdrawn" && i === 0));
          const isLast = i === maxIdx;

          return (
            <div key={nodeLabel} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
              <div
                className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all ${
                  isFailedNode
                    ? "bg-error"
                    : isActive
                      ? "bg-primary ring-2 ring-primary/40 animate-pulse"
                      : isFilled
                        ? isSigned
                          ? "bg-success"
                          : "bg-primary"
                        : "border border-card-border bg-card"
                }`}
              />
              {!isLast && (
                <div
                  className={`flex-1 h-px ${
                    i < filledUpTo ? (isSigned ? "bg-success" : "bg-primary") : "bg-card-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex">
        {nodes.map((nodeLabel, i) => {
          const isLast = i === maxIdx;
          return (
            <div
              key={nodeLabel}
              className={`text-[8px] text-muted leading-none ${
                isLast ? "text-right shrink-0" : "flex-1"
              } ${i === 0 ? "text-left" : isLast ? "" : "text-center"}`}
            >
              {nodeLabel}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted pt-0.5">
        <LocalTime value={proposedAt} options={{ dateStyle: "medium" }} />
        {failedNote && <span className="text-error/80 font-medium">{failedNote}</span>}
        {isVoting && votingEndsAt && (
          <span className="text-yellow-400">
            Closes{" "}
            <LocalTime value={votingEndsAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
          </span>
        )}
      </div>
    </div>
  );
}
