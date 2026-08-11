"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ClaimButtonProps {
  kind: "player" | "corporation" | "party";
}

const LABELS: Record<ClaimButtonProps["kind"], string> = {
  player: "Create my player page",
  corporation: "Create my corporation page",
  party: "Create my party page",
};

export function ClaimButton({ kind }: ClaimButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = LABELS[kind];

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wiki/my/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: kind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not create page");
      }
      const { slug } = (await res.json()) as { slug: string };
      router.push(`/wiki/${slug}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create page");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Creating…" : label}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
