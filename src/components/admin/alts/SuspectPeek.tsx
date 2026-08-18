"use client";

// Peek card for a suspected alt: in-game name opens a small window with
// username, email, IP, tracking cookie, a ban control, and a profile link.
// Network values are already redacted server-side for moderators.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { DiscordContact } from "./DiscordContact";
import { SuspectMugshot } from "./SuspectPortrait";
import type { ToastKind } from "./ModeratorActions";
import {
  memberInGameName,
  memberProfileHref,
  ROLE_LABEL,
  type AltContext,
  type AltMemberIdentity,
  type AltMemberRole,
} from "./altTypes";

type Suspect = AltMemberIdentity & { role?: AltMemberRole };

interface PeekApi {
  context: AltContext;
  onMemberBanned: (userId: string) => void;
  notify: (msg: string, kind: ToastKind) => void;
}

const PeekCtx = createContext<PeekApi | null>(null);

export function SuspectPeekProvider({
  context,
  onMemberBanned,
  notify,
  children,
}: PeekApi & { children: ReactNode }) {
  return (
    <PeekCtx.Provider value={{ context, onMemberBanned, notify }}>{children}</PeekCtx.Provider>
  );
}

export function SuspectNameButton({
  member,
  className = "truncate text-sm font-semibold text-primary hover:underline",
}: {
  member: Suspect;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = memberInGameName(member);
  const bannedCls = member.banned ? " line-through decoration-red-500/80" : "";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className={`${className}${bannedCls} max-w-full text-left`}
      >
        {name}
      </button>
      {open && <SuspectPeekCard member={member} onClose={() => setOpen(false)} />}
    </>
  );
}

function SuspectPeekCard({ member, onClose }: { member: Suspect; onClose: () => void }) {
  const peek = useContext(PeekCtx);
  const isAdmin = peek?.context === "admin";
  const apiBase = isAdmin ? "/api/admin" : "/api/moderator";
  const name = memberInGameName(member);
  const href = memberProfileHref(member);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  async function ban() {
    if (!peek) return;
    setBusy(true);
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
      peek.onMemberBanned(member.userId);
      peek.notify(`Banned ${name}.`, "success");
      onClose();
    } catch (e) {
      peek.notify(e instanceof Error ? e.message : "Failed to ban member", "error");
    } finally {
      setBusy(false);
    }
  }

  const ip =
    member.lastKnownIp && member.registrationIp && member.lastKnownIp !== member.registrationIp
      ? member.lastKnownIp
      : (member.lastKnownIp ?? member.registrationIp);

  const overlay = (
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] motion-reduce:animate-none"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} account`}
        className="w-full max-w-md rounded-xl border border-card-border bg-card p-4 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <SuspectMugshot member={member} size="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground">{name}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {member.role && <span>{ROLE_LABEL[member.role]}</span>}
              {member.banned && (
                <span className="rounded-md border border-red-400/25 bg-red-500/10 px-1.5 py-0.5 text-red-400">
                  Banned
                </span>
              )}
            </div>
            <DiscordContact
              discordId={member.discordId}
              discordUsername={member.discordUsername}
              discordCreatedAt={member.discordCreatedAt}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:text-foreground"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <dl className="space-y-1.5 text-xs">
          <PeekField label="Username" value={member.name} />
          <PeekField label="Email" value={member.email} mono />
          <PeekField label="IP" value={ip} mono />
          {member.registrationIp &&
            member.lastKnownIp &&
            member.registrationIp !== member.lastKnownIp && (
              <PeekField label="Reg. IP" value={member.registrationIp} mono />
            )}
          <PeekField
            label="Cookie"
            value={member.trackingId}
            mono
            adminOnly={!isAdmin && !member.trackingId}
          />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {href && (
            <Link
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-sm font-medium transition-colors hover:bg-card-elevated"
            >
              Open profile
            </Link>
          )}
          {!member.banned && peek && (
            <button
              type="button"
              onClick={() => setConfirming((v) => !v)}
              className="inline-flex h-9 items-center rounded-lg border border-red-400/40 bg-red-500/10 px-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20"
            >
              Ban
            </button>
          )}
        </div>

        {confirming && !member.banned && (
          <div className="mt-3 space-y-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for ban (optional)…"
              rows={2}
              className="w-full resize-none rounded-lg border border-card-border bg-background px-3 py-2 text-sm placeholder:text-muted/70 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void ban()}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {busy ? "Banning…" : "Confirm ban"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return overlay;
  return createPortal(overlay, document.body);
}

function PeekField({
  label,
  value,
  mono,
  adminOnly,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  adminOnly?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[11px] font-medium text-muted">{label}</dt>
      <dd
        className={`min-w-0 break-all ${mono ? "font-mono text-[11px] tracking-tight" : ""}`}
        title={value ?? undefined}
      >
        {value ??
          (adminOnly ? (
            <span className="text-muted">
              — <span className="text-[9px] font-semibold uppercase tracking-wide">admin</span>
            </span>
          ) : (
            "—"
          ))}
      </dd>
    </div>
  );
}
