"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { PlayerSelector } from "@/components/PlayerSelector";

interface InviteRow {
  id: string;
  invitedCharacterId: string;
  invitedCharacterName: string;
  issuedByCharacterName: string;
  shares: number;
  pricePerShare: number;
  totalCost: number;
  currencyCode: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface Props {
  corporationId: string;
  corporationName: string;
  isCeo: boolean;
  /** Max shareholders allowed by the corp's legal structure (e.g. 100 for S-Corp). */
  maxShareholders: number;
  /** Current number of distinct shareholders (with > 0 shares). */
  currentShareholderCount: number;
  /** Active character id of the viewer (for "this is my invite" checks). */
  viewerCharacterId: string | null;
  onChange?: () => void;
}

/**
 * Surfaces the private-share invitation flow for close-corporation legal
 * structures (e.g. US S-Corp, capped at 100 shareholders).
 *
 * - CEO sees a form to invite a character + a list of pending invites with
 *   a Cancel action per row.
 * - Invitees (non-CEO with a pending invite for this corp) see an Accept /
 *   Decline panel inline.
 */
export function ManagePrivateShareholdersPanel({
  corporationId,
  corporationName,
  isCeo,
  maxShareholders,
  currentShareholderCount,
  viewerCharacterId,
  onChange,
}: Props) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Form state (CEO only)
  const [invitedCharacterId, setInvitedCharacterId] = useState("");
  const [invitedCharacterName, setInvitedCharacterName] = useState("");
  const [shares, setShares] = useState("");
  const [pricePerShare, setPricePerShare] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporation/${corporationId}/private-invites`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to load invites");
        setInvites([]);
      } else {
        setInvites(Array.isArray(data.invites) ? data.invites : []);
      }
    } catch {
      setError("Network error loading invites");
    } finally {
      setLoading(false);
    }
  }, [corporationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!isCeo) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const sharesNum = Number(shares);
      const priceNum = Number(pricePerShare);
      if (!invitedCharacterId.trim() || !Number.isFinite(sharesNum) || !Number.isFinite(priceNum)) {
        setError("All fields are required");
        return;
      }
      const res = await fetch(`/api/corporation/${corporationId}/private-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitedCharacterId: invitedCharacterId.trim(),
          shares: sharesNum,
          pricePerShare: priceNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to send invite");
        return;
      }
      setMessage(`Invitation sent.`);
      setInvitedCharacterId("");
      setInvitedCharacterName("");
      setShares("");
      setPricePerShare("");
      await reload();
      onChange?.();
    } finally {
      setSubmitting(false);
    }
  }

  async function inviteAction(inviteId: string, action: "accept" | "decline" | "cancel") {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`/api/corporation/${corporationId}/private-invites/${inviteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Failed to ${action}`);
        return;
      }
      if (action === "accept") setMessage("Shares acquired.");
      else if (action === "decline") setMessage("Invite declined.");
      else setMessage("Invite cancelled.");
      await reload();
      onChange?.();
    } finally {
      setSubmitting(false);
    }
  }

  // For invitees: filter to invites addressed to them only.
  const myInvites = !isCeo ? invites.filter((i) => i.invitedCharacterId === viewerCharacterId) : [];

  if (!isCeo && myInvites.length === 0 && !loading) {
    return null; // Nothing to show for non-invitees.
  }

  const seatsRemaining = Math.max(0, maxShareholders - currentShareholderCount);

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-h4 font-semibold text-foreground">
            {isCeo ? "Private Shareholders" : `Share Offer from ${corporationName}`}
          </h2>
          {isCeo && (
            <p className="text-body-sm text-muted-foreground">
              Invite specific characters to buy shares of this private corporation. Capped at{" "}
              {maxShareholders.toLocaleString("en-US")} shareholders ({currentShareholderCount}{" "}
              current, {seatsRemaining} seats remaining).
            </p>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-body-sm text-error">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-body-sm text-success">
          {message}
        </div>
      )}

      {isCeo && (
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-body-sm">
              <span className="block mb-1 text-muted-foreground">Invitee</span>
              {invitedCharacterId ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
                  <span className="truncate text-body-sm text-foreground">
                    {invitedCharacterName}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setInvitedCharacterId("");
                      setInvitedCharacterName("");
                    }}
                    className="text-body-xs text-muted-foreground hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <PlayerSelector
                  placeholder="Search by name or username..."
                  onSelect={(c) => {
                    setInvitedCharacterId(c.id);
                    setInvitedCharacterName(c.name);
                  }}
                />
              )}
            </label>
            <label className="block text-body-sm">
              <span className="block mb-1 text-muted-foreground">Shares</span>
              <input
                type="number"
                min={1}
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-body-sm"
                required
              />
            </label>
            <label className="block text-body-sm">
              <span className="block mb-1 text-muted-foreground">Price per share</span>
              <input
                type="number"
                step="0.01"
                min={0.01}
                value={pricePerShare}
                onChange={(e) => setPricePerShare(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-body-sm"
                required
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting || seatsRemaining <= 0}
            className="rounded-md bg-primary px-3 py-1.5 text-body-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Send invitation"}
          </button>
        </form>
      )}

      <div className="space-y-2">
        <h3 className="text-body-sm font-medium text-muted-foreground">
          {isCeo ? "Pending invitations" : "Your pending invitations"}
        </h3>
        {loading ? (
          <ul className="min-h-[120px] space-y-2">
            {[1, 2].map((i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <Skeleton className="h-7 w-16 rounded-md" />
              </li>
            ))}
          </ul>
        ) : (isCeo ? invites : myInvites).length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <ul className="space-y-2">
            {(isCeo ? invites : myInvites).map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm text-foreground">
                    {isCeo ? (
                      <>
                        <span className="font-medium">{inv.invitedCharacterName}</span> —{" "}
                        {inv.shares.toLocaleString("en-US")} shares @ {inv.currencyCode}{" "}
                        {inv.pricePerShare.toLocaleString("en-US")} = {inv.currencyCode}{" "}
                        {inv.totalCost.toLocaleString("en-US")}
                      </>
                    ) : (
                      <>
                        {inv.shares.toLocaleString("en-US")} shares of {corporationName} @{" "}
                        {inv.currencyCode} {inv.pricePerShare.toLocaleString("en-US")} (total{" "}
                        {inv.currencyCode} {inv.totalCost.toLocaleString("en-US")})
                      </>
                    )}
                  </p>
                  <p className="text-body-xs text-muted-foreground">
                    Issued by {inv.issuedByCharacterName} · expires{" "}
                    {/* wall-clock by design: private share invites have real-time validity */}
                    {new Date(inv.expiresAt).toLocaleString("en-US")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {isCeo ? (
                    <button
                      type="button"
                      onClick={() => inviteAction(inv.id, "cancel")}
                      disabled={submitting}
                      className="rounded-md border border-border px-2 py-1 text-body-xs hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => inviteAction(inv.id, "accept")}
                        disabled={submitting}
                        className="rounded-md bg-primary px-3 py-1 text-body-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Accept & pay
                      </button>
                      <button
                        type="button"
                        onClick={() => inviteAction(inv.id, "decline")}
                        disabled={submitting}
                        className="rounded-md border border-border px-2 py-1 text-body-xs hover:bg-muted disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
