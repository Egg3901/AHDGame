"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import type { CorpsMember } from "@/lib/db/collections/characterGenerals";
import { rankProgress } from "@/lib/military/generals";
import { SectionCard, Badge } from "../dossier";
import { ActingLockNote, useActingLock } from "../ActingLock";

const STATE_LABEL: Record<CorpsMember["state"], { text: string; tone: "up" | "muted" }> = {
  serving: { text: "Serving", tone: "up" },
  dismissed: { text: "Former", tone: "muted" },
};

/**
 * A general's one-line standing: rank, discipline, and what the next promotion needs.
 *
 * This line used to read "{spec} · Lvl {level}", which misled twice over. "Unassigned"
 * beside a "Serving" badge read as a posting rather than an untrained doctrine tree,
 * and a bare level number said nothing about how a general advances — both of which a
 * player asked about in the same breath. Promotion is automatic on battle XP, so the
 * honest answer is to show the XP.
 */
function standingLine(m: CorpsMember): string {
  if (m.level == null) return m.spec ?? "";
  const prog = rankProgress(m.level, m.xp ?? 0);
  const parts = [prog.rank];
  if (m.spec) parts.push(m.spec);
  parts.push(
    prog.nextRank ? `${prog.xpIntoRank}/${prog.xpForRank} XP to ${prog.nextRank}` : "highest rank"
  );
  return parts.join(" · ");
}

/**
 * The Secretary of Defense's personnel view of the general corps.
 *
 * Commissioning is the SecDef's call, but nothing after it is: a general's discipline
 * is DERIVED from the doctrine nodes they train, and only the owning player can train
 * them, so a fresh appointment reads "No specialisation" until they spend their points.
 * Dismissal keeps the record — a former general can be re-appointed and returns with
 * their level, xp and traits intact.
 */
export function GeneralCorps({
  corps,
  candidates,
  countryCode,
  positionId,
  lockReason,
}: {
  corps: CorpsMember[];
  candidates: { characterId: string; name: string }[];
  countryCode: string;
  positionId: string;
  /**
   * Set when an acting secretary may not commission or dismiss. The corps stays
   * fully readable (a caretaker still needs to know who they have), and only
   * the two writes close.
   */
  lockReason?: string | null;
}) {
  const router = useRouter();
  const contextLock = useActingLock("personnel");
  const lock = lockReason ?? contextLock;
  const canWrite = !!positionId && !lock;
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/country/${countryCode}/executive/cabinet/${positionId}/generals`;

  const run = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That did not work.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const commission = (characterId: string) =>
    run(() =>
      fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      })
    ).then(() => setPick(""));

  const dismiss = (characterId: string) =>
    run(() => fetch(`${base}/${characterId}`, { method: "DELETE" }));

  const serving = corps.filter((m) => m.state !== "dismissed");
  const former = corps.filter((m) => m.state === "dismissed");

  return (
    <SectionCard
      title="General corps"
      sub="Commission officers into the corps; they specialise through what they train, and promote by leading units in battle"
      right={
        !canWrite ? (
          <Badge tone="muted">{lock ? "Acting - read-only" : "Read-only"}</Badge>
        ) : undefined
      }
    >
      <ActingLockNote reason={lock} />

      {canWrite && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Commission a character as a general"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={busy || candidates.length === 0}
            className="min-w-0 flex-1 rounded-lg border border-card-border bg-card px-3 py-2 text-[13px] text-foreground"
          >
            <option value="">
              {candidates.length === 0 ? "No eligible characters" : "Select a character…"}
            </option>
            {candidates.map((c) => (
              <option key={c.characterId} value={c.characterId}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pick || busy}
            onClick={() => pick && commission(pick)}
            className="shrink-0 rounded-lg bg-[var(--gov)] px-3 py-2 text-[12px] font-bold text-[#1a1200] disabled:opacity-40"
          >
            Commission
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-[11px] text-error">{error}</p>}

      {corps.length === 0 ? (
        <p className="text-[12px] text-muted">
          No generals commissioned. Commission a character to build a general staff.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[...serving, ...former].map((m) => (
            <div
              key={m.characterId}
              className="flex flex-wrap items-center gap-2 rounded-md border border-card-border bg-card px-2.5 py-1.5"
            >
              <Link
                href={`/character/${m.characterId}`}
                className="min-w-0 flex-1 truncate text-[13px] text-foreground hover:text-gov-soft hover:underline"
                title="Open this general's profile — doctrine is trained there"
              >
                {m.name}
              </Link>
              <span className="dossier-label hidden shrink-0 text-muted sm:inline">
                {standingLine(m)}
              </span>
              <Badge tone={STATE_LABEL[m.state].tone}>{STATE_LABEL[m.state].text}</Badge>
              {canWrite &&
                (m.state === "dismissed" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => commission(m.characterId)}
                    aria-label={`Re-appoint ${m.name}`}
                    title="Re-appoint — their record is restored"
                    className="shrink-0 rounded-md border border-card-border px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-foreground"
                  >
                    RE-APPOINT
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => dismiss(m.characterId)}
                    aria-label={`Dismiss ${m.name}`}
                    title="Dismiss — their record is kept, but they lose every command and posting"
                    className="shrink-0 rounded-md border border-card-border px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-error"
                  >
                    DISMISS
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
