"use client";

import { useState } from "react";
import type { ReferendumStatus } from "@/lib/db/types/referendum";
import { DeclarePositionControl } from "./DeclarePositionControl";
import { GroundGameControl } from "./GroundGameControl";

export type RailRole = "auto" | "pm" | "leader" | "player" | "spectator";

const card = "rounded-2xl border border-card-border bg-card p-5 shadow-card";

interface Props {
  countryId: string;
  regionId: string;
  referendumId: string;
  status: ReferendumStatus;
  kind: "independence" | "reunification";
  yesShare: number;
  campaignCloseTurn: number | null;
  currentTurn: number;
  isPM: boolean;
  isAdmin: boolean;
  /** The admin "Viewing as" role (from `?as=`); non-admins always see "auto". */
  role: RailRole;
  viewerCanDeclare?: boolean;
  viewerDeclaredSide?: "yes" | "no" | null;
  viewerCanGroundGame?: boolean;
  groundGameMode?: "official" | "volunteer";
  groundGameTarget?: "whole" | { groupId: string };
  groundGameTargetName?: string;
  groundGameSaturation?: number;
  groundGameLabels?: { yes: string; no: string };
}

/**
 * The detail-page action rail. Renders exactly the modules the viewer can use,
 * derived from real capabilities (PM grant/decline, side-agnostic PS spend,
 * admin convert/block). Admins get a preview-as-role toggle that only changes
 * which module renders — the backend still authorizes every action.
 */
export function CampaignRail(props: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role: RailRole = props.isAdmin ? props.role : "auto";
  const effPm = role === "auto" ? props.isPM : role === "pm";
  const showAdminActuate = props.status === "actuating" && props.isAdmin && role === "auto";

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Action failed.");
        setBusy(false);
        return;
      }
      setBusy(false);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setBusy(false);
    }
  }

  const submitBase = `/api/country/${props.countryId.toLowerCase()}/referendum/${props.referendumId}/submit`;
  const actuateUrl = `/api/admin/referendum/${props.referendumId}/actuate`;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      )}

      {/* requested → PM gate or await-PM */}
      {props.status === "requested" &&
        (effPm ? (
          <div
            className="rounded-2xl border bg-card p-5 shadow-card"
            style={{ borderColor: "color-mix(in srgb, var(--ref-amber) 40%, var(--card-border))" }}
          >
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-amber)]">
              Prime Minister&apos;s decision
            </div>
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
              Grant the referendum to open a public campaign and ballot, or decline the request.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => post(submitBase, { action: "grant" })}
                className="rounded-lg bg-primary px-4 py-3 text-[13.5px] font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? "Granting…" : "Grant the referendum"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => post(submitBase, { action: "decline" })}
                className="rounded-lg border border-[var(--ref-no)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ref-no)] transition-colors hover:bg-[color-mix(in_srgb,var(--ref-no)_10%,transparent)] disabled:opacity-50"
              >
                Decline — refuse the request
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl border p-5"
            style={{
              background: "color-mix(in srgb, var(--ref-amber) 12%, transparent)",
              borderColor: "color-mix(in srgb, var(--ref-amber) 35%, transparent)",
            }}
          >
            <div className="mb-1.5 text-[13px] font-bold text-[var(--ref-amber)]">
              Awaiting Westminster
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              The campaign cannot open until the Prime Minister grants this referendum.
            </p>
          </div>
        ))}

      {/* campaigning → party position declaration (Chair/Vice) */}
      {props.status === "campaigning" && props.viewerCanDeclare && (
        <DeclarePositionControl
          countryId={props.countryId}
          referendumId={props.referendumId}
          currentSide={props.viewerDeclaredSide ?? null}
        />
      )}

      {/* campaigning → preset ground game (same-nation officials + volunteers) */}
      {props.status === "campaigning" && props.viewerCanGroundGame && (
        <GroundGameControl
          countryId={props.countryId}
          referendumId={props.referendumId}
          mode={props.groundGameMode ?? "volunteer"}
          target={props.groundGameTarget ?? "whole"}
          targetName={props.groundGameTargetName ?? "Whole electorate"}
          saturation={props.groundGameSaturation ?? 0}
          labels={props.groundGameLabels ?? { yes: "Yes", no: "No" }}
        />
      )}

      {/* actuating → admin convert/block */}
      {showAdminActuate && (
        <div className={card}>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ref-amber)]">
            Conversion window — admin
          </div>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => post(actuateUrl, { action: "resolve" })}
              className="rounded-lg bg-[var(--ref-amber)] px-4 py-3 text-[13.5px] font-bold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Converting…" : "Convert now"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => post(actuateUrl, { action: "block" })}
              className="rounded-lg border border-[var(--ref-no)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ref-no)] transition-colors hover:bg-[color-mix(in_srgb,var(--ref-no)_10%,transparent)] disabled:opacity-50"
            >
              Block
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
