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
  regionId,
}: {
  countryCode: string;
  electionId: string;
  regionId: string;
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
      <div className="rounded-lg border border-card-border bg-card/80 px-3 py-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Manifesto · {regionId}
        </h4>
        <p className="text-[10px] text-muted">
          Only the party leader sets the manifesto for this campaign.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-card-border bg-card/80 px-3 py-2 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Manifesto · {data.party?.name ?? regionId}
        </h4>
        <span className="text-[10px] text-muted">
          {locked ? "locked" : `${selected.length}/${maxPledges} pledges`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {data.catalog.map((entry) => {
          const active = selected.includes(entry.id);
          const disabled = locked || (!active && selected.length >= maxPledges);
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(entry.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-card-border text-muted hover:text-foreground"
              } ${disabled && !active ? "opacity-40" : ""}`}
              title={entry.blurb}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {error ? <p className="text-[10px] text-danger">{error}</p> : null}

      {locked ? (
        <p className="text-[10px] text-muted">Manifesto locked for this election.</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => submit("save")}
            className="rounded border border-card-border px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy || selected.length !== maxPledges}
            onClick={() => submit("lock")}
            className="rounded border border-foreground bg-foreground px-2 py-1 text-[11px] text-background disabled:opacity-50"
            title={
              selected.length !== maxPledges
                ? `Pick ${maxPledges} pledges to lock`
                : "Lock this manifesto for the campaign"
            }
          >
            Lock in
          </button>
        </div>
      )}
    </div>
  );
}
