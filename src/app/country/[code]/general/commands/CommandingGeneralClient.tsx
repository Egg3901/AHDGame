"use client";

import { useCallback, useMemo, useState } from "react";
import type { MilitaryCommand, CommanderRef } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictAssignment } from "@/lib/military/assignments";
import { THEATER_COMMAND } from "@/lib/military/config";
import { CommandStructurePanel } from "./CommandStructurePanel";

/** A conflict a general can be posted to (dynamic — the retired static theaters are gone). */
export interface ConflictOption {
  id: string;
  name: string;
}

/**
 * The defence office this command was built in, offered only to a viewer who may
 * actually open it. Null for a country with no defence seat, and null for the
 * ordinary Commanding General, whom the cabinet fog-of-war gate keeps out.
 */
export interface DefenceOfficeLink {
  href: string;
  /** The seat's era-resolved name, so the link says where it goes. */
  seatName: string;
}

/**
 * The Commanding General's employment surface: post the command's generals to
 * Conflicts and designate a Theater Commander.
 *
 * Units are not chosen here. A general's force is derived — every unit the Secretary
 * of Defense has assigned to them — and it follows them to their posting. The force
 * shown per general is read-only.
 */
export function CommandingGeneralClient({
  countryCode,
  command,
  generals,
  unitLeaders,
  units,
  conflictAssignments,
  conflicts = [],
  defenceOffice = null,
}: {
  countryCode: string;
  command: MilitaryCommand;
  /** This command's own generals — the ones the CG posts. */
  generals: CommanderRef[];
  /**
   * The country's whole general roster, used only to NAME whoever leads each unit.
   * A unit in this command can be assigned to a general in another one, and reading
   * that as unled would be wrong. Defaults to this command's generals.
   */
  unitLeaders?: CommanderRef[];
  units: MilitaryUnit[];
  conflictAssignments: ConflictAssignment[];
  /** The live conflicts a general can be posted to. Empty until one breaks out. */
  conflicts?: ConflictOption[];
  /**
   * Where this command was built, for the rare CG who also holds or oversees the
   * defence seat. Null when the viewer may not open that office — the command's
   * own structure is published below regardless, so nothing is lost by omitting it.
   * The copy says where the command comes from rather than "edit it", because a
   * head of government passes the same gate and may read that office without
   * being able to pull any of its levers.
   */
  defenceOffice?: DefenceOfficeLink | null;
}) {
  // A posting's conflict resolves to its live name; a stale id falls back to itself.
  const theaterName = (id: string) => conflicts.find((c) => c.id === id)?.name ?? id;
  const ownGenerals = useMemo(() => new Set(command.commanderIds), [command.commanderIds]);
  // Only this CG's own generals' postings are theirs to edit; the rest of the
  // country's assignments are left untouched (the route merges them back).
  const [mine, setMine] = useState<ConflictAssignment[]>(
    conflictAssignments.filter((a) => ownGenerals.has(a.generalCharacterId))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const postingOf = (id: string) => mine.find((a) => a.generalCharacterId === id) ?? null;

  const save = useCallback(
    async (next: ConflictAssignment[]) => {
      setSaving(true);
      setError(null);
      setSaved(false);
      try {
        const res = await fetch(`/api/country/${countryCode}/general/assignments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conflictAssignments: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not save postings.");
          return;
        }
        setSaved(true);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSaving(false);
      }
    },
    [countryCode]
  );

  const apply = (next: ConflictAssignment[]) => {
    setMine(next);
    void save(next);
  };

  const setPosting = (generalCharacterId: string, theaterId: string | null) => {
    const rest = mine.filter((a) => a.generalCharacterId !== generalCharacterId);
    if (!theaterId) return apply(rest);
    // A move never carries the command with it; the general's units follow via
    // their own assignedGeneralId, so there is nothing to carry here.
    apply([...rest, { theaterId, generalCharacterId, inCharge: false }]);
  };

  const setInCharge = (generalCharacterId: string) => {
    const me = postingOf(generalCharacterId);
    if (!me) return;
    apply(
      mine.map((a) =>
        a.theaterId === me.theaterId
          ? { ...a, inCharge: a.generalCharacterId === generalCharacterId }
          : a
      )
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="dossier-label text-muted">Commanding General</div>
        <h1 className="text-lg font-semibold text-foreground">{command.name}</h1>
        <p className="mt-1 text-[12px] text-muted">
          Post your generals to Conflicts and designate who is in charge of each front. The units
          the Secretary of Defense assigns to a general follow them to their posting.
        </p>
        {/* The TC choice is the most consequential control on this page and said
            nothing about what it does. Both effects are real and worth knowing
            before choosing: canActAtTheater locks the front to the TC once one
            exists, and THEATER_COMMAND.bonusShare spreads their edge front-wide. */}
        <p className="mt-2 text-[12px] text-muted">
          One general at each conflict can be its{" "}
          <strong className="text-foreground">Theater Commander (TC)</strong>. Only the TC may
          declare offensives at that front — naming one takes that authority out of the Secretary of
          Defense&rsquo;s hands. {Math.round(THEATER_COMMAND.bonusShare * 100)}% of the edge their
          own traits would give the units they personally lead also carries to every one of your
          units there, so the strongest trait set matters more than the highest rank.
        </p>
        {/* A Command lives on two pages: built in the defence seat's office, employed
            here. Its makeup is published below rather than linked to, because the
            cabinet fog-of-war gate shuts an ordinary CG out of that office. This
            link is only for the viewer who may actually open it. */}
        {defenceOffice && (
          <a
            href={defenceOffice.href}
            className="mt-2 inline-block text-[11px] font-semibold text-muted underline decoration-dotted underline-offset-2 hover:text-gov-soft"
          >
            This command is built in the {defenceOffice.seatName}&rsquo;s office →
          </a>
        )}
        <div className="mt-3 flex items-center gap-3 text-[11px]">
          {saving && <span className="text-muted">Saving…</span>}
          {saved && !saving && !error && <span className="text-success">Saved</span>}
          {error && <span className="text-error">{error}</span>}
        </div>
      </div>

      <CommandStructurePanel command={command} generals={unitLeaders ?? generals} units={units} />

      {/* Named for the same reason the structure panel is: both list the command's
          generals, one as a roster and one as the postings surface. */}
      <section aria-label="Postings">
        {generals.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="text-[13px] text-muted">
              Your command has no generals yet. The Secretary of Defense assigns commanders to a
              command.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {generals.map((g) => {
              const posting = postingOf(g.id);
              const led = units.filter((u) => u.assignedGeneralId === g.id);
              return (
                <div key={g.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {g.name}
                    </span>
                    <span className="dossier-label text-muted">
                      {g.spec} · Lvl {g.level}
                    </span>
                    {posting?.inCharge && (
                      <span className="rounded-full border border-[var(--gov)] px-2 py-0.5 text-[10px] font-semibold text-gov-soft">
                        ◉ THEATER COMMANDER
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Post ${g.name} to a conflict`}
                      value={posting?.theaterId ?? ""}
                      onChange={(e) => setPosting(g.id, e.target.value || null)}
                      className="min-w-0 flex-1 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[13px] text-foreground"
                    >
                      <option value="">Not posted to a conflict</option>
                      {conflicts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {posting && !posting.inCharge && (
                      <button
                        type="button"
                        onClick={() => setInCharge(g.id)}
                        aria-label={`Put ${g.name} in charge of ${theaterName(posting.theaterId)}`}
                        title="Make Theater Commander — only they may declare offensives at this front"
                        className="shrink-0 rounded-md border border-card-border px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:text-foreground"
                      >
                        MAKE TC
                      </button>
                    )}
                  </div>

                  {posting && (
                    <div className="mt-3">
                      <div className="dossier-label mb-1.5 text-muted">
                        Force at {theaterName(posting.theaterId)} · {led.length}
                      </div>
                      {led.length === 0 ? (
                        <p className="text-[11px] text-muted">
                          No units assigned to this general yet — the Secretary of Defense assigns
                          units to generals.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {led.map((u) => (
                            <span
                              key={String(u._id)}
                              className="rounded-md border border-card-border px-2 py-1 text-[11px] text-muted"
                            >
                              {u.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
