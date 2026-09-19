"use client";

import { useState } from "react";
import type { CoalitionDetail } from "@/lib/coalitions/types";

export function CoalitionIdentityForm({
  coalition,
  endpoint,
  onSaved,
}: {
  coalition: Pick<CoalitionDetail, "name" | "abbreviation" | "color">;
  endpoint: string;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(coalition.name);
  const [abbreviation, setAbbreviation] = useState(coalition.abbreviation);
  const [color, setColor] = useState(coalition.color);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="rounded-xl border border-card-border bg-card p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setMessage("");
        try {
          const response = await fetch(endpoint, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, abbreviation, color }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not update coalition.");
          await onSaved();
          setMessage("Coalition identity updated.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not update coalition.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <h2 className="mb-1 text-lg font-semibold">Coalition identity</h2>
      <p className="mb-4 text-sm text-muted">
        Update the name, abbreviation, and colour shown across your coalition.
      </p>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Name
          <input
            required
            minLength={3}
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-card-border bg-background p-2"
          />
        </label>
        <label className="text-sm">
          Abbreviation
          <input
            required
            minLength={2}
            maxLength={10}
            value={abbreviation}
            onChange={(event) => setAbbreviation(event.target.value)}
            className="mt-1 w-full rounded border border-card-border bg-background p-2"
          />
        </label>
        <label className="text-sm">
          Colour
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="mt-1 block h-11 w-20"
          />
        </label>
        <button
          type="submit"
          className="self-end rounded bg-primary px-4 py-3 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save identity"}
        </button>
      </fieldset>
      <p role="status" className="mt-3 text-sm">
        {message}
      </p>
    </form>
  );
}
