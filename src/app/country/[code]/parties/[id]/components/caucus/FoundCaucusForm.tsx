"use client";

import { useState } from "react";
import { Slider } from "@/components/ui";
import { apiBase } from "./caucusUtils";

export function FoundCaucusForm({
  countryCode,
  partyId,
  onSuccess,
  onError,
}: {
  countryCode: string;
  partyId: string;
  onSuccess: (slug: string) => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3a7bd5");
  const [taxRate, setTaxRate] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(apiBase(countryCode, partyId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          taxRate,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        caucus?: { slug: string };
      };
      if (!res.ok || !data.success || !data.caucus) {
        onError(data.error ?? "Failed to found caucus.");
      } else {
        onSuccess(data.caucus.slug);
      }
    } catch {
      onError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] uppercase tracking-widest text-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
            placeholder="e.g. Main Street Republicans"
          />
        </label>
        <label className="text-[11px] uppercase tracking-widest text-muted">
          Color
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border border-card-border bg-background"
            />
            <span className="font-mono text-xs normal-case tracking-normal">{color}</span>
          </div>
        </label>
      </div>

      <label className="block text-[11px] uppercase tracking-widest text-muted">
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm normal-case tracking-normal"
          rows={2}
          placeholder="Pragmatic, business-friendly, socially moderate."
        />
      </label>

      <label className="block text-[11px] uppercase tracking-widest text-muted">
        Caucus Tax | {taxRate}%
        <div className="mt-3 w-full sm:w-1/2">
          <Slider
            min={0}
            max={5}
            step={0.5}
            value={taxRate}
            onChange={(e) => setTaxRate(parseFloat(e.target.value))}
            className="w-full"
            aria-label="Caucus tax"
          />
        </div>
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
        >
          {submitting ? "Founding..." : "Found caucus"}
        </button>
      </div>
    </form>
  );
}
