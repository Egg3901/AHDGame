"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";
import { BLEND, FONT } from "@/components/blend/tokens";
import {
  blendButtonStyle,
  BlendLabel,
  BlendNote,
  BlendProse,
  BlendSelect,
} from "@/components/blend/BlendControls";

interface SuspendEndorsePanelProps {
  campaignId: string;
  campaignSuspended: boolean;
  suspendedAt?: string | null;
  endorsedCandidate?: { id: string; name: string } | null;
  endorsementTargetWithdrawn?: boolean;
  suspendEndorse?: {
    eligible: boolean;
    targets: Array<{ id: string; name: string; party: string }>;
  };
  onRefresh: () => void;
}

export function SuspendEndorsePanel({
  campaignId,
  campaignSuspended,
  suspendedAt,
  endorsedCandidate,
  endorsementTargetWithdrawn = false,
  suspendEndorse,
  onRefresh,
}: SuspendEndorsePanelProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedTarget = suspendEndorse?.targets.find((t) => t.id === selectedTargetId);

  async function handleConfirm() {
    if (!selectedTargetId || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/suspend-endorse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: selectedTargetId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to suspend and endorse");
        return;
      }
      setConfirmOpen(false);
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
      return;
    } finally {
      setBusy(false);
    }
  }

  if (campaignSuspended) {
    return (
      <div style={{ marginBottom: 22 }}>
        <h3
          style={{
            margin: "0 0 10px",
            fontFamily: FONT.serif,
            fontSize: 17,
            fontWeight: 600,
          }}
        >
          Campaign suspended
        </h3>
        <BlendNote tone="caution">
          You remain on the ballot, but active campaigning is paused.
          {endorsementTargetWithdrawn ? (
            <>
              {" "}
              Your endorsed candidate withdrew. You remain suspended on the ballot, but no transfers
              are active.
            </>
          ) : endorsedCandidate ? (
            <>
              {" "}
              You endorsed{" "}
              <span style={{ color: BLEND.ink, fontWeight: 600 }}>{endorsedCandidate.name}</span>.
              25% of your campaign strength transferred immediately at endorsement. 25% of your
              per-state character org boosts their electoral vote math each turn, and your org is
              not debited. Your existing votes are preserved but you will not accumulate any more.
            </>
          ) : null}
        </BlendNote>
        {suspendedAt && (
          <div
            style={{
              marginTop: 7,
              fontFamily: FONT.mono,
              fontSize: 10.5,
              color: BLEND.mutedDimmer,
            }}
          >
            Suspended <LocalTime value={suspendedAt} />
          </div>
        )}
      </div>
    );
  }

  if (!suspendEndorse?.eligible) {
    return null;
  }

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <h3
          style={{
            margin: "0 0 8px",
            fontFamily: FONT.serif,
            fontSize: 17,
            fontWeight: 600,
          }}
        >
          Suspend and endorse
        </h3>
        <BlendProse>
          Step aside during the general election and back another nominee. You stay on the ballot,
          but campaign operations stop. 25% of your campaign strength transfers immediately to your
          endorsed candidate. 25% of your per-state character org boosts their electoral vote math
          each turn, and your org is not debited. Your existing votes are preserved but you will not
          accumulate any more.
        </BlendProse>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <BlendLabel htmlFor="endorse-target">Endorse</BlendLabel>
          <BlendSelect
            id="endorse-target"
            value={selectedTargetId}
            onChange={(e) => setSelectedTargetId(e.target.value)}
          >
            <option value="">Select a candidate…</option>
            {suspendEndorse.targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name} ({target.party})
              </option>
            ))}
          </BlendSelect>

          {error && <BlendNote tone="error">{error}</BlendNote>}

          <button
            type="button"
            disabled={!selectedTargetId || busy}
            onClick={() => {
              setError("");
              setConfirmOpen(true);
            }}
            style={blendButtonStyle("caution", !!selectedTargetId && !busy)}
          >
            Suspend campaign and endorse
          </button>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        title="Suspend campaign and endorse?"
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
      >
        <div className="space-y-3 text-sm">
          <p>
            You will suspend active campaigning for the rest of the general election and endorse{" "}
            <span className="font-semibold">{selectedTarget?.name}</span>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>You remain on the ballot. This is not a withdrawal.</li>
            <li>Campaign upgrades, rallies, travel, and turn income stop immediately.</li>
            <li>
              25% of your campaign strength transfers immediately to their campaign (one-time).
            </li>
            <li>
              25% of your per-state character org boosts their electoral vote math each turn, and
              your org is not debited.
            </li>
            <li>Your existing votes are preserved but you will not accumulate any more.</li>
            <li>This cannot be undone.</li>
          </ul>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={busy}
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-card/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="rounded-lg bg-warning px-3 py-1.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Confirming..." : "Confirm"}
          </button>
        </div>
      </Modal>
    </>
  );
}
