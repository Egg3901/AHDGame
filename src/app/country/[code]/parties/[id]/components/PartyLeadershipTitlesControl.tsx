"use client";

import { useState } from "react";
import { apiErrorText } from "@/lib/errors/catalog";
import type { PartyLeadershipTitleKey, PartyLeadershipTitles } from "@/lib/db/types/party";
import {
  getPartyRoleLabel,
  MAX_PARTY_LEADERSHIP_TITLE_LENGTH,
} from "@/lib/parties/partyRoleLabels";
import { partyApiUrl } from "@/lib/urls";

const TITLE_KEYS: readonly PartyLeadershipTitleKey[] = ["chair", "viceChair", "treasurer"];

const FIELD_LABELS: Record<PartyLeadershipTitleKey, string> = {
  chair: "Chair title",
  viceChair: "Vice chair title",
  treasurer: "Treasurer title",
};

function toDraft(titles?: PartyLeadershipTitles | null): Record<PartyLeadershipTitleKey, string> {
  return {
    chair: titles?.chair?.trim() ?? "",
    viceChair: titles?.viceChair?.trim() ?? "",
    treasurer: titles?.treasurer?.trim() ?? "",
  };
}

export function PartyLeadershipTitlesControl({
  partyId,
  countryId,
  leadershipTitles,
  onUpdate,
}: {
  partyId: string;
  countryId: string;
  leadershipTitles?: PartyLeadershipTitles | null;
  onUpdate: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(leadershipTitles));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const hasChanges = TITLE_KEYS.some(
    (key) => draft[key].trim() !== (leadershipTitles?.[key]?.trim() ?? "")
  );

  const saveTitles = async () => {
    if (saving || !hasChanges) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${partyApiUrl(countryId, partyId)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadershipTitles: {
            chair: draft.chair.trim() || null,
            viceChair: draft.viceChair.trim() || null,
            treasurer: draft.treasurer.trim() || null,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage(apiErrorText(data, "Failed to save leadership titles."));
        return;
      }
      setDraft(
        toDraft({
          chair: draft.chair.trim() || null,
          viceChair: draft.viceChair.trim() || null,
          treasurer: draft.treasurer.trim() || null,
        })
      );
      setMessage("Leadership titles saved.");
      onUpdate();
    } catch {
      setMessage("Network error saving leadership titles.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="party-leadership-titles-heading" className="space-y-4">
      <div>
        <h3 id="party-leadership-titles-heading" className="text-sm font-semibold text-muted">
          Leadership titles
        </h3>
        <p className="mt-1 text-sm text-muted">
          Set optional display titles for your party officers. Leave a field blank to use the
          existing title for this country.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {TITLE_KEYS.map((key) => {
          const inputId = `party-leadership-title-${key}`;
          return (
            <div key={key} className="space-y-1.5">
              <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
                {FIELD_LABELS[key]}
              </label>
              <input
                id={inputId}
                type="text"
                maxLength={MAX_PARTY_LEADERSHIP_TITLE_LENGTH}
                value={draft[key]}
                placeholder={getPartyRoleLabel(countryId, key)}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, [key]: event.target.value }));
                  setMessage("");
                }}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveTitles}
          disabled={saving || !hasChanges}
          className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save titles"}
        </button>
        {message && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
