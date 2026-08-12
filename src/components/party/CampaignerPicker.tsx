"use client";

import { useMemo, useState } from "react";

interface PickableMember {
  id: string;
  name: string;
  homeState?: string;
  isNPP?: boolean;
}

interface AssignedLeader {
  id: string;
  name: string;
}

interface CampaignerPickerProps {
  /** "1" = single state slot, "3" = national 3-slot. */
  mode: "single" | "triple";
  /** Already-assigned characters (resolved by the API as LeaderInfo). */
  current: AssignedLeader[];
  /** Pool of selectable party members. NPPs are filtered out by this component. */
  members: PickableMember[];
  /** Optional state filter — when set, only members with `homeState === stateId` show. */
  filterStateId?: string;
  /** Save handler. Receives the new id list (single mode passes [] or [id]). */
  /**
   * Persist the staged roster. May return a message to show instead of the
   * generic confirmation — national campaigner saves report whether names
   * were seated or sent to the National Committee for confirmation.
   */
  onSave: (ids: string[]) => Promise<string | void> | string | void;
  /** Display color for the save button. */
  partyColor: string;
  /** Whether the viewer is allowed to assign (chair / admin). */
  canAssign: boolean;
}

/**
 * Typeahead picker for the chair-assignable Campaigner role. Supports the
 * national 3-slot mode and the state 1-slot mode. Filters by typed text
 * (case-insensitive substring on member name), and — when `filterStateId`
 * is set — restricts the pool to members in that state.
 *
 * Excludes NPPs and members already in `current` from the suggestion list.
 */
export function CampaignerPicker({
  mode,
  current,
  members,
  filterStateId,
  onSave,
  partyColor,
  canAssign,
}: CampaignerPickerProps) {
  const max = mode === "triple" ? 3 : 1;
  const [staged, setStaged] = useState<AssignedLeader[]>(current);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const eligibleMembers = useMemo(() => {
    return members.filter((m) => {
      if (m.isNPP) return false;
      if (filterStateId && m.homeState !== filterStateId) return false;
      return true;
    });
  }, [members, filterStateId]);

  const trimmed = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (staged.length >= max) return [];
    const stagedIds = new Set(staged.map((s) => s.id));
    return eligibleMembers
      .filter((m) => !stagedIds.has(m.id))
      .filter((m) => (trimmed ? m.name.toLowerCase().includes(trimmed) : true))
      .slice(0, 8);
  }, [eligibleMembers, staged, trimmed, max]);

  const dirty = staged.length !== current.length || staged.some((s, i) => s.id !== current[i]?.id);

  const handleAdd = (member: PickableMember) => {
    if (staged.length >= max) return;
    setStaged([...staged, { id: member.id, name: member.name }]);
    setQuery("");
    setMsg("");
  };

  const handleRemove = (id: string) => {
    setStaged(staged.filter((s) => s.id !== id));
    setMsg("");
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const result = await onSave(staged.map((s) => s.id));
      setMsg(typeof result === "string" && result ? `✓ ${result}` : "✓ Campaigners updated");
    } catch (err) {
      setMsg(err instanceof Error ? `✗ ${err.message}` : "✗ Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Slot summary */}
      <div className="flex flex-wrap gap-2">
        {staged.length === 0 ? (
          <span className="text-muted italic text-sm">No campaigners assigned</span>
        ) : (
          staged.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card px-3 py-1 text-xs font-medium"
            >
              {s.name}
              {canAssign && (
                <button
                  type="button"
                  onClick={() => handleRemove(s.id)}
                  className="text-muted hover:text-error"
                  aria-label={`Remove ${s.name}`}
                  title="Remove"
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
        <span className="text-xs text-muted self-center">
          {staged.length} / {max} slot{max === 1 ? "" : "s"}
        </span>
      </div>

      {/* Typeahead */}
      {canAssign && staged.length < max && (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              filterStateId ? `Search party members in ${filterStateId}…` : "Search party members…"
            }
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          {trimmed && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-card-border bg-card shadow-md max-h-56 overflow-y-auto">
              {suggestions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleAdd(m)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-background border-b border-card-border/40 last:border-b-0"
                >
                  {m.name}
                  {m.homeState && <span className="ml-2 text-xs text-muted">{m.homeState}</span>}
                </button>
              ))}
            </div>
          )}
          {trimmed && suggestions.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-muted">
              No matching {filterStateId ? `${filterStateId} ` : ""}party members
            </div>
          )}
        </div>
      )}

      {/* Save / status row */}
      {canAssign && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: partyColor }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {msg && (
            <span className={`text-xs ${msg.startsWith("✓") ? "text-success" : "text-error"}`}>
              {msg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
