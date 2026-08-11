"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin-only action bar on the crisis detail page (resolve a live crisis). */
export default function CrisisAdminActions({
  crisisId,
  status,
}: {
  crisisId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const resolve = async () => {
    if (!confirm("Resolve this crisis now? It will stop applying effects.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crises/${crisisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve" }),
      });
      if (res.ok) {
        setMsg("Resolved");
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setMsg(d.error ?? "Failed to resolve");
      }
    } catch {
      setMsg("Failed to resolve");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Admin</span>
      {status === "active" ? (
        <button
          onClick={resolve}
          disabled={busy}
          className="rounded border border-amber-500 bg-amber-500/10 px-3 py-1 text-sm text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? "Resolving…" : "Resolve crisis"}
        </button>
      ) : (
        <span className="text-sm text-muted">Crisis already resolved.</span>
      )}
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}
