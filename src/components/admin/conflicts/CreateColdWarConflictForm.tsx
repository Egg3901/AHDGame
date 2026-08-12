"use client";

import { useState } from "react";

/**
 * Admin creation for a Cold War Conflict.
 *
 * Nothing else in the game creates one — `declareWar` only builds interstate wars
 * between playable countries — so this form is what makes the whole proxy-war feature
 * reachable, and it is the only writer of `hostCountry`/`hostEntities`.
 */
export function CreateColdWarConflictForm() {
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [anchor, setAnchor] = useState("");
  const [aLabel, setALabel] = useState("");
  const [aFaction, setAFaction] = useState("");
  const [bLabel, setBLabel] = useState("");
  const [bFaction, setBFaction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/conflicts/cold-war/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          hostCountry: anchor.trim().toUpperCase(),
          hostEntities: hosts
            .split(",")
            .map((h) => h.trim().toUpperCase())
            .filter(Boolean),
          sideA: { label: aLabel, factionEntity: aFaction, backer: "west", tokenStrength: 40 },
          sideB: { label: bLabel, factionEntity: bFaction, backer: "east", tokenStrength: 40 },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Creation failed.");
        return;
      }
      setCreated(data.conflictId);
    } catch {
      setError("Creation failed.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="rounded-lg border border-card-border bg-card px-2 py-1 text-sm text-foreground"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <section className="mt-6 rounded-xl border border-card-border bg-card p-4 shadow-card">
      <h3 className="font-serif text-lg text-foreground">Create Cold War Conflict</h3>
      <p className="mt-0.5 max-w-xl text-sm text-muted">
        A proxy war fought on third-party soil. Both sides are factions backed by a bloc; host
        entities are the countries that change bloc when it resolves.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field("cw-name", "Conflict name", name, setName, "Vietnam War")}
        {field("cw-hosts", "Host entities (comma separated)", hosts, setHosts, "NVN, SVN")}
        {field("cw-anchor", "Map anchor", anchor, setAnchor, "SVN")}
        <div />
        {field("cw-a-label", "Side A label (West)", aLabel, setALabel, "Republic of Vietnam")}
        {field("cw-a-faction", "Side A faction entity", aFaction, setAFaction, "SVN")}
        {field("cw-b-label", "Side B label (East)", bLabel, setBLabel, "DRV")}
        {field("cw-b-faction", "Side B faction entity", bFaction, setBFaction, "NVN")}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="mt-4 inline-flex items-center justify-center rounded-lg border border-card-border px-4 py-2 text-sm font-semibold text-foreground transition-colors disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create conflict"}
      </button>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
      {created != null && (
        <p className="mt-3 text-sm text-success">
          Created conflict #{created}. View it at /world/conflicts/{created}.
        </p>
      )}
    </section>
  );
}
