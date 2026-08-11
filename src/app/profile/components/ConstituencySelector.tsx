"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { Button, Input } from "@/components/ui";

interface ConstituencyOption {
  id: string;
  name: string;
  regionId: string;
}

interface ConstituencyResponse {
  eligible: boolean;
  officeType?: "commons" | "primeMinister";
  regionId?: string;
  selected: { id: string; name: string } | null;
  constituencies: ConstituencyOption[];
}

function matches(option: ConstituencyOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return option.name.toLowerCase().includes(q) || option.id.toLowerCase().includes(q);
}

export function ConstituencySelector() {
  const [data, setData] = useState<ConstituencyResponse | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<ConstituencyResponse>("/api/character/constituency", {
      cache: "no-store",
      feature: "constituency-selector",
    })
      .then((payload: ConstituencyResponse | null) => {
        if (cancelled || !payload) return;
        setData(payload);
        if (payload.selected) {
          setSelectedId(payload.selected.id);
          setQuery(payload.selected.name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => data?.constituencies.find((option) => option.id === selectedId) ?? null,
    [data?.constituencies, selectedId]
  );

  const suggestions = useMemo(() => {
    if (!data) return [];
    return data.constituencies.filter((option) => matches(option, query)).slice(0, 8);
  }, [data, query]);

  if (!data?.eligible) return null;

  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/character/constituency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constituencyId: selectedId }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      setMessage(payload?.error ?? "Could not save constituency");
      return;
    }
    setMessage("Constituency saved");
    if (payload?.selected?.name) {
      setQuery(payload.selected.name);
      setOpen(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {data.officeType === "primeMinister"
              ? "Prime Minister's Constituency"
              : "Commons Constituency"}
          </h2>
          <p className="text-xs text-muted">
            {data.officeType === "primeMinister"
              ? "Choose the constituency the Prime Minister represents."
              : "Choose the constituency your MP represents."}
          </p>
        </div>
        {data.selected && <span className="text-xs text-muted">{data.selected.id}</span>}
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId("");
            setOpen(true);
            setMessage(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Type a constituency name..."
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-card-border bg-card-elevated shadow-lg">
            {suggestions.map((option) => (
              <button
                key={option.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSelectedId(option.id);
                  setQuery(option.name);
                  setOpen(false);
                  setMessage(null);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-foreground hover:bg-card-border/50"
              >
                <span>{option.name}</span>
                <span className="shrink-0 text-xs text-muted">{option.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-xs ${message?.includes("saved") ? "text-success" : "text-error"}`}>
          {message}
        </p>
        <Button size="sm" onClick={save} disabled={!selected || saving} isLoading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
