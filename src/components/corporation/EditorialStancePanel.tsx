"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export interface EditorialStanceView {
  economic: number;
  social: number;
}

export function EditorialStancePanel({
  corporationId,
  stance,
  isCeo,
  onSaved,
}: {
  corporationId: string;
  stance?: EditorialStanceView;
  isCeo: boolean;
  onSaved?: () => void;
}) {
  const t = useTranslations("corporations.editorialStance");
  const [economic, setEconomic] = useState(stance?.economic ?? 0);
  const [social, setSocial] = useState(stance?.social ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/corporations/${corporationId}/editorial-stance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ economic, social }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t("saveFailed"));
        return;
      }
      onSaved?.();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="editorial-stance-title"
    >
      <h2 id="editorial-stance-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("description")}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <span>
            {t("economic")}: {stanceValue(economic)}
          </span>
          <input
            type="range"
            min={-5}
            max={5}
            step={1}
            value={economic}
            disabled={!isCeo || saving}
            onChange={(event) => setEconomic(Number(event.target.value))}
            aria-label={t("economic")}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span>
            {t("social")}: {stanceValue(social)}
          </span>
          <input
            type="range"
            min={-5}
            max={5}
            step={1}
            value={social}
            disabled={!isCeo || saving}
            onChange={(event) => setSocial(Number(event.target.value))}
            aria-label={t("social")}
          />
        </label>
      </div>
      {isCeo && (
        <button
          type="button"
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={
            saving || (economic === (stance?.economic ?? 0) && social === (stance?.social ?? 0))
          }
          onClick={() => void save()}
        >
          {saving ? t("saving") : t("save")}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
    </section>
  );
}

function stanceValue(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}
