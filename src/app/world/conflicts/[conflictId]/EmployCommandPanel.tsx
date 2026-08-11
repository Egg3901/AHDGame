"use client";

import { useCallback, useState } from "react";
import type { ConflictAssignment } from "@/lib/military/assignments";
import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** One general the viewer's Command may post to this conflict. */
export interface EmployableGeneral {
  id: string;
  name: string;
  /** Divisions assigned to them — they travel with the general. */
  divisions: number;
  /** Total personnel under them, already formatted. */
  men: string;
}

export interface EmployCommandProps {
  countryCode: string;
  theaterId: string;
  generals: EmployableGeneral[];
  /**
   * Every posting this Commanding General owns, ACROSS all conflicts. The route
   * merges other commands' rows back in, but this CG's own must be sent whole or
   * posting a general here would recall the ones they have posted elsewhere.
   */
  ownAssignments: ConflictAssignment[];
}

const btn = (tone: "gold" | "plain" | "muted") => ({
  border: `1px solid ${tone === "gold" ? MIL_COLOR.gold : MIL_COLOR.border}`,
  background: tone === "gold" ? "rgba(212,175,55,.14)" : MIL_COLOR.panel,
  color: tone === "gold" ? MIL_COLOR.gold : tone === "muted" ? MIL_COLOR.textFaint : "#c8c8d4",
  borderRadius: 7,
  padding: "6px 10px",
  font: `600 9.5px ${mono}`,
  cursor: tone === "muted" ? ("not-allowed" as const) : ("pointer" as const),
  whiteSpace: "nowrap" as const,
});

/**
 * Post this Command's generals to this front, and designate one to hold it.
 *
 * The lever a Commanding General holds lived only on their own Commands page, so
 * the seat that decides who stands at a front could see the front and not act on
 * it. Units are NOT chosen here and never were: a general's force is derived from
 * `assignedGeneralId` and follows them to their posting, which is why posting is
 * the only control that reinforces anything.
 *
 * Writes through the same PUT the Commands page uses, so authority is enforced
 * server-side (`requireCommandingGeneral`) and the one-Theater-Commander-per-
 * conflict invariant is re-validated over the merged whole.
 */
export function EmployCommandPanel({
  countryCode,
  theaterId,
  generals,
  ownAssignments,
}: EmployCommandProps) {
  const [mine, setMine] = useState<ConflictAssignment[]>(ownAssignments);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = (id: string) =>
    mine.find((a) => a.generalCharacterId === id && a.theaterId === theaterId) ?? null;
  /**
   * Posted, but to a different conflict. A general holds ONE posting, so "Post
   * here" quietly moves them off whatever front they are standing on — which the
   * panel has to say before the click, not after.
   */
  const elsewhere = (id: string) =>
    mine.some((a) => a.generalCharacterId === id && a.theaterId !== theaterId);
  const tcId =
    mine.find((a) => a.theaterId === theaterId && a.inCharge)?.generalCharacterId ?? null;
  const tc = generals.find((g) => g.id === tcId) ?? null;
  const postedCount = generals.filter((g) => here(g.id)).length;

  const save = useCallback(
    async (next: ConflictAssignment[], previous: ConflictAssignment[]) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/country/${countryCode}/general/assignments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conflictAssignments: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          // Rolled back, not left optimistic: the route re-checks command
          // membership and the one-TC-per-conflict rule, and a panel that keeps
          // showing a posting the server refused is worse than no panel.
          setMine(previous);
          setError(body?.error ?? "Could not save postings.");
        }
      } catch {
        setMine(previous);
        setError("Could not reach the server.");
      } finally {
        setSaving(false);
      }
    },
    [countryCode]
  );

  const apply = (next: ConflictAssignment[]) => {
    const previous = mine;
    setMine(next);
    void save(next, previous);
  };

  /** Post to this front, or recall from it. A general holds one posting at a time. */
  const togglePost = (id: string) => {
    const rest = mine.filter((a) => a.generalCharacterId !== id);
    if (here(id)) return apply(rest);
    apply([...rest, { theaterId, generalCharacterId: id, inCharge: false }]);
  };

  /**
   * Designating is a TOGGLE: clicking the sitting commander vacates the seat and
   * hands declaring back to the defense secretary. Without that, a designation
   * could be moved but never undone.
   */
  const designate = (id: string) => {
    if (!here(id)) return;
    const vacate = tcId === id;
    apply(
      mine.map((a) =>
        a.theaterId === theaterId
          ? { ...a, inCharge: vacate ? false : a.generalCharacterId === id }
          : a
      )
    );
  };

  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 11,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          EMPLOY YOUR COMMAND
        </div>
        <div style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint }}>
          {saving
            ? "Saving…"
            : postedCount === 0
              ? "no generals posted"
              : `${postedCount} general${postedCount === 1 ? "" : "s"} posted`}
        </div>
      </div>

      {error && (
        <div style={{ font: `500 10.5px ${mono}`, color: "#ff5a3c", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {generals.length === 0 ? (
        <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textFaint, lineHeight: 1.6 }}>
          Your command has no generals yet. The defense secretary assigns commanders to a command.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {generals.map((g) => {
            const posted = here(g.id) != null;
            const away = !posted && elsewhere(g.id);
            const isTc = tcId === g.id;
            return (
              <div
                key={g.id}
                data-general={g.id}
                style={{
                  border: `1px solid ${isTc ? "rgba(212,175,55,.45)" : MIL_COLOR.borderSoft}`,
                  borderRadius: 10,
                  background: isTc ? "rgba(212,175,55,.06)" : MIL_COLOR.inset,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <span style={{ font: `600 11.5px ${mono}`, color: MIL_COLOR.text }}>
                        {g.name}
                      </span>
                      <span
                        style={{
                          font: `600 8.5px ${mono}`,
                          letterSpacing: ".08em",
                          color: isTc
                            ? MIL_COLOR.gold
                            : posted
                              ? MIL_COLOR.green
                              : away
                                ? MIL_COLOR.amber
                                : MIL_COLOR.textFaint,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isTc
                          ? "THEATER"
                          : posted
                            ? "AT THIS FRONT"
                            : away
                              ? "AT ANOTHER FRONT"
                              : "UNPOSTED"}
                      </span>
                    </div>
                    <div style={{ font: `500 9.5px ${mono}`, color: "#7a7a8c", marginTop: 3 }}>
                      {g.divisions} division{g.divisions === 1 ? "" : "s"} · {g.men} men
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => designate(g.id)}
                      disabled={!posted || saving}
                      title={
                        posted
                          ? undefined
                          : "A general must stand at this front before they can hold its theater."
                      }
                      style={btn(posted ? "plain" : "muted")}
                    >
                      {isTc ? "Stand down" : "Designate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePost(g.id)}
                      disabled={saving}
                      title={
                        away
                          ? "This general is posted to another conflict — posting them here moves them, and their divisions with them."
                          : undefined
                      }
                      style={btn(posted ? "plain" : "gold")}
                    >
                      {posted ? "Recall" : away ? "Move here" : "Post here"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
          marginTop: 12,
          paddingTop: 11,
        }}
      >
        <span style={{ font: `500 10.5px ${mono}`, color: "#c8c8d4" }}>Theater Commander here</span>
        <span
          style={{
            font: `600 10.5px ${mono}`,
            color: tc ? MIL_COLOR.gold : MIL_COLOR.textFaint,
          }}
        >
          {tc ? tc.name : "None designated"}
        </span>
      </div>

      <div
        style={{
          font: `500 10px ${mono}`,
          color: MIL_COLOR.textMuted,
          marginTop: 9,
          lineHeight: 1.6,
        }}
      >
        {tc
          ? `${tc.name} holds the theater, so offensives here are declared by them rather than the cabinet. Standing them down returns that to the defense secretary.`
          : "No Theater Commander is designated, so the declare button sits with the defense secretary. Designate any posted general to move it here. A general's divisions travel with them — posting them brings those divisions to this front."}
      </div>
    </div>
  );
}
