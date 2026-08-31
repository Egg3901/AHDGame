/**
 * UK manifesto authoring bar during the Commons campaign window.
 *
 * Party leaders pick up to 3 pledges from the curated catalog and save/lock
 * them for the election (epic #856, ticket #857). Non-leaders and locked
 * manifestos render read-only. The vote-share effect is gated separately by
 * UK_MANIFESTO_VOTE_EFFECT, so this is safe to surface before the effect is on.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

interface CatalogEntry {
  id: string;
  label: string;
  blurb?: string;
  policyDomain: string;
}

interface ManifestoResponse {
  catalog: CatalogEntry[];
  pledgeCount: number;
  isPartyLeader: boolean;
  party: { id: string; name: string } | null;
  manifesto: { pledges: string[]; locked: boolean; lockedAt: string | null } | null;
}

export function ManifestoFlavorBar({
  countryCode,
  electionId,
}: {
  countryCode: string;
  electionId: string;
}) {
  const endpoint = `/api/country/${countryCode}/elections/${electionId}/manifesto`;
  const [data, setData] = useState<ManifestoResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ManifestoResponse | null) => {
        if (!alive || !json) return;
        setData(json);
        setSelected(json.manifesto?.pledges ?? []);
        setLocked(Boolean(json.manifesto?.locked));
      })
      .catch((err) => {
        // Non-fatal: the bar stays hidden. Capture so the failure isn't silent.
        if (alive) setError(err instanceof Error ? err.message : "Could not load manifesto");
      });
    return () => {
      alive = false;
    };
  }, [endpoint]);

  const maxPledges = data?.pledgeCount ?? 3;

  const toggle = useCallback(
    (id: string) => {
      if (locked) return;
      setSelected((prev) => {
        if (prev.includes(id)) return prev.filter((p) => p !== id);
        if (prev.length >= maxPledges) return prev;
        return [...prev, id];
      });
    },
    [locked, maxPledges]
  );

  const submit = useCallback(
    async (action: "save" | "lock") => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pledges: selected, action }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error ?? "Could not save manifesto");
          return;
        }
        if (action === "lock") setLocked(true);
      } finally {
        setBusy(false);
      }
    },
    [endpoint, selected]
  );

  // Nothing to show until we know the viewer's role.
  if (!data) return null;

  if (!data.isPartyLeader) {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Election Manifesto
        </h3>
        <p className="mt-2 text-body-sm text-muted">
          Only the party leader sets the manifesto for this campaign.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
          Election Manifesto
        </h3>
        {data.party?.name ? (
          <span className="text-body-sm font-medium text-foreground">{data.party.name}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-body-sm text-muted">
          {locked
            ? "Manifesto locked for this campaign."
            : "Choose the pledges you'll run on. Keeping them rewards you; breaking them costs you."}
        </p>
        <div className="ml-3 flex shrink-0 items-center gap-1" aria-hidden>
          {Array.from({ length: maxPledges }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${
                i < selected.length ? "bg-foreground" : "bg-card-muted ring-1 ring-card-border"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {data.catalog.map((entry) => {
          const active = selected.includes(entry.id);
          const disabled = locked || (!active && selected.length >= maxPledges);
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(entry.id)}
              title={entry.blurb}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-body-sm transition-colors ${
                active
                  ? "border-foreground/60 bg-foreground/10 text-foreground"
                  : "border-card-border text-muted hover:border-foreground/40 hover:text-foreground"
              } ${disabled && !active ? "opacity-40" : ""}`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-card-border"
                  }`}
                >
                  {active ? "✓" : ""}
                </span>
                {entry.label}
              </span>
              <span className="shrink-0 text-caption uppercase tracking-wide text-muted">
                {entry.policyDomain}
              </span>
            </button>
          );
        })}
      </div>

      {error ? <p className="text-body-sm text-danger">{error}</p> : null}

      {!locked && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => submit("save")}
            className="rounded border border-card-border px-3 py-1.5 text-body-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || selected.length !== maxPledges}
            onClick={() => submit("lock")}
            className="rounded border border-foreground bg-foreground px-3 py-1.5 text-body-sm text-background disabled:opacity-50"
            title={
              selected.length !== maxPledges
                ? `Pick ${maxPledges} pledges to lock`
                : "Lock this manifesto for the campaign"
            }
          >
            Lock in
          </button>
          <span className="text-caption text-muted">
            {selected.length} of {maxPledges} chosen
          </span>
        </div>
      )}
    </div>
  );
}
