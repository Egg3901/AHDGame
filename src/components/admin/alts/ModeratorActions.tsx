"use client";

// ModeratorActions (plan §4.8): the act step of triage. Moderators can ban a
// member, add a mod note, dismiss the cluster, or mark it reviewed; admins
// additionally mark it confirmed and export the evidence. Destructive actions
// go through a confirm dialog; every call surfaces in-flight state and a
// success/failure toast.
//
// Endpoint reuse (per task brief): ban → `${apiBase}/users/ban`; mod note →
// admin `PATCH /api/admin/users/mod-note` / moderator
// `POST /api/moderator/users/mod-notes` (exact shapes mirrored from
// UsersTab / SuspiciousActivityTab). Cluster status transitions PATCH the
// cluster resource (`/api/admin/alts/cluster/[id]`); the UI updates
// optimistically and reverts on failure.

import { useState } from "react";
import type { AltClusterStatus, AltContext, ClusterDetail, ClusterMember } from "./altTypes";
import { ROLE_LABEL, STATUS_LABEL } from "./altTypes";

export type ToastKind = "success" | "error" | "info";

interface ModeratorActionsProps {
  cluster: ClusterDetail;
  context: AltContext;
  onStatusChange: (status: AltClusterStatus) => void;
  onMemberBanned: (userId: string) => void;
  notify: (msg: string, kind: ToastKind) => void;
}

type PendingAction =
  { kind: "status"; status: AltClusterStatus } | { kind: "ban" } | { kind: "note" };

const BTN =
  "inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 motion-reduce:transition-none";

export function ModeratorActions({
  cluster,
  context,
  onStatusChange,
  onMemberBanned,
  notify,
}: ModeratorActionsProps) {
  const isAdmin = context === "admin";
  const apiBase = isAdmin ? "/api/admin" : "/api/moderator";
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const bannableMembers = cluster.members.filter((m) => !m.banned);

  async function updateStatus(status: AltClusterStatus, note?: string) {
    setBusy(`status:${status}`);
    const prev = cluster.status;
    onStatusChange(status); // optimistic
    try {
      const res = await fetch(`/api/admin/alts/cluster/${cluster.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note?.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      notify(`Cluster marked ${STATUS_LABEL[status].toLowerCase()}.`, "success");
    } catch (e) {
      onStatusChange(prev); // revert
      notify(e instanceof Error ? e.message : "Failed to update status", "error");
    } finally {
      setBusy(null);
    }
  }

  async function banMember(member: ClusterMember, reason: string) {
    setBusy(`ban:${member.userId}`);
    try {
      const res = await fetch(`${apiBase}/users/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.userId,
          ban: true,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onMemberBanned(member.userId);
      notify(`Banned ${member.name ?? "member"}.`, "success");
      setPending(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to ban member", "error");
    } finally {
      setBusy(null);
    }
  }

  async function addNote(member: ClusterMember, text: string) {
    setBusy(`note:${member.userId}`);
    try {
      const res = await fetch(
        isAdmin ? "/api/admin/users/mod-note" : "/api/moderator/users/mod-notes",
        {
          method: isAdmin ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isAdmin ? { userId: member.userId, note: text } : { userId: member.userId, text }
          ),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      notify(`Note saved for ${member.name ?? "member"}.`, "success");
      setPending(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to save note", "error");
    } finally {
      setBusy(null);
    }
  }

  function exportEvidence() {
    const payload = JSON.stringify(cluster, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alt-cluster-${cluster.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Cluster evidence exported.", "success");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          className={`${BTN} border-card-border hover:bg-card-elevated`}
          disabled={busy !== null || cluster.status === "reviewed"}
          onClick={() => updateStatus("reviewed")}
        >
          {busy === "status:reviewed" ? "Marking…" : "Mark reviewed"}
        </button>

        <button
          className={`${BTN} border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/10`}
          disabled={busy !== null || cluster.status === "dismissed"}
          onClick={() => setPending({ kind: "status", status: "dismissed" })}
        >
          Dismiss cluster
        </button>

        {isAdmin && (
          <button
            className={`${BTN} border-red-500/30 text-red-400 hover:border-red-500/50 hover:bg-red-500/10`}
            disabled={busy !== null || cluster.status === "confirmed"}
            onClick={() => setPending({ kind: "status", status: "confirmed" })}
            title="Admin: confirm this is a real alt ring"
          >
            Mark confirmed
          </button>
        )}

        <button
          className={`${BTN} border-red-500/30 text-red-400 hover:border-red-500/50 hover:bg-red-500/10`}
          disabled={busy !== null || bannableMembers.length === 0}
          onClick={() => setPending({ kind: "ban" })}
        >
          Ban member…
        </button>

        <button
          className={`${BTN} border-card-border hover:bg-card-elevated`}
          disabled={busy !== null}
          onClick={() => setPending({ kind: "note" })}
        >
          Add mod note…
        </button>

        {isAdmin && (
          <button
            className={`${BTN} border-card-border hover:bg-card-elevated`}
            onClick={exportEvidence}
          >
            Export evidence
          </button>
        )}
      </div>

      {pending?.kind === "status" && (
        <ConfirmDialog
          title={pending.status === "dismissed" ? "Dismiss cluster" : "Mark confirmed"}
          confirmLabel={pending.status === "dismissed" ? "Dismiss" : "Confirm"}
          destructive={pending.status === "confirmed"}
          withNote
          notePlaceholder="Review note (optional)…"
          body={
            pending.status === "dismissed"
              ? "Mark this cluster as a false positive / benign. It drops out of the default open queue."
              : "Confirm this is a real alt ring. This is an admin-level determination and is logged."
          }
          busy={busy !== null}
          onCancel={() => setPending(null)}
          onConfirm={(note) => updateStatus(pending.status, note)}
        />
      )}

      {pending?.kind === "ban" && (
        <MemberActionDialog
          title="Ban member"
          confirmLabel="Confirm ban"
          destructive
          members={bannableMembers}
          notePlaceholder="Reason for ban (optional)…"
          busy={busy !== null}
          onCancel={() => setPending(null)}
          onConfirm={(member, reason) => banMember(member, reason)}
        />
      )}

      {pending?.kind === "note" && (
        <MemberActionDialog
          title="Add mod note"
          confirmLabel="Save note"
          members={cluster.members}
          notePlaceholder="Investigation note…"
          requireNote
          busy={busy !== null}
          onCancel={() => setPending(null)}
          onConfirm={(member, text) => addNote(member, text)}
        />
      )}
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-card-border bg-card p-5 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

const FIELD_CLS =
  "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted/70 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25 motion-reduce:transition-none";

const DIALOG_CANCEL_CLS =
  "inline-flex h-10 items-center rounded-lg border border-card-border px-4 text-sm transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none";

function dialogConfirmCls(destructive?: boolean): string {
  return `inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50 motion-reduce:transition-none ${
    destructive
      ? "bg-red-600 hover:bg-red-500 focus-visible:ring-red-500/60"
      : "bg-primary hover:bg-primary-dark focus-visible:ring-primary/60"
  }`;
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  withNote?: boolean;
  notePlaceholder?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note?: string) => void;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive,
  withNote,
  notePlaceholder,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [note, setNote] = useState("");
  return (
    <Overlay onClose={onCancel}>
      <h3 className={`mb-1 text-base font-semibold ${destructive ? "text-red-400" : ""}`}>
        {title}
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-muted">{body}</p>
      {withNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={notePlaceholder}
          rows={3}
          className={`${FIELD_CLS} mb-4 resize-none`}
        />
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={DIALOG_CANCEL_CLS}>
          Cancel
        </button>
        <button
          onClick={() => onConfirm(note)}
          disabled={busy}
          className={dialogConfirmCls(destructive)}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}

interface MemberActionDialogProps {
  title: string;
  confirmLabel: string;
  destructive?: boolean;
  members: ClusterMember[];
  notePlaceholder: string;
  requireNote?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (member: ClusterMember, note: string) => void;
}

function MemberActionDialog({
  title,
  confirmLabel,
  destructive,
  members,
  notePlaceholder,
  requireNote,
  busy,
  onCancel,
  onConfirm,
}: MemberActionDialogProps) {
  const [selectedId, setSelectedId] = useState(members[0]?.userId ?? "");
  const [note, setNote] = useState("");
  const selected = members.find((m) => m.userId === selectedId);
  const canSubmit = Boolean(selected) && (!requireNote || note.trim().length > 0);

  return (
    <Overlay onClose={onCancel}>
      <h3 className={`mb-4 text-base font-semibold ${destructive ? "text-red-400" : ""}`}>
        {title}
      </h3>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Member
      </label>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className={`${FIELD_CLS} mb-3`}
      >
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {(m.name ?? `user·${m.userId.slice(-6)}`) + ` — ${ROLE_LABEL[m.role]}`}
          </option>
        ))}
      </select>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={notePlaceholder}
        rows={3}
        className={`${FIELD_CLS} mb-4 resize-none`}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={DIALOG_CANCEL_CLS}>
          Cancel
        </button>
        <button
          onClick={() => selected && onConfirm(selected, note)}
          disabled={busy || !canSubmit}
          className={dialogConfirmCls(destructive)}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
