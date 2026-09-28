"use client";

import { useEffect, useState } from "react";

interface TargetUnion {
  unionId: string;
  name: string;
}

type Posture = "tolerant" | "normal" | "crackdown";

export function UnionEnforcementDesk({
  countryId,
  unions,
}: {
  countryId: string;
  unions: TargetUnion[];
}) {
  const [authorized, setAuthorized] = useState(false);
  const [posture, setPosture] = useState<Posture>("normal");
  const [canChange, setCanChange] = useState(false);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `/api/country/${countryId.toLowerCase()}/union-enforcement`;

  useEffect(() => {
    let cancelled = false;
    fetch(path)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setAuthorized(true);
        setPosture(data.posture);
        setCanChange(data.canChangePosture);
      })
      .catch((error) => {
        console.error("Failed to load union enforcement posture", error);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!authorized) return null;

  async function submit(body: object) {
    setBusy(true);
    setResult("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setResult(data.error ?? "Enforcement action failed.");
      } else if ("posture" in data) {
        setPosture(data.posture);
        setCanChange(false);
        setResult(`Enforcement posture set to ${data.posture}.`);
      } else if ("strengthLoss" in data) {
        setResult(
          `Raid removed ${data.strengthLoss} cell strength${data.sympathyGain ? `; sympathy restored ${data.sympathyGain}` : ""}. Two action points spent. This cell cannot be raided again for three turns.`
        );
      } else {
        setResult(`Investigation found ${data.heat} heat. One action point spent.`);
      }
    } catch {
      setResult("Enforcement action failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Union enforcement" className="rounded-xl border border-border p-4 text-sm">
      <h2 className="font-semibold">Executive union enforcement</h2>
      <p className="mt-1 text-xs text-muted">
        Investigate a domestic union for one action point, raid an exposed or high heat cell for
        two, or change the standing detection posture once per turn.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="union-enforcement-posture">Posture</label>
        <select
          id="union-enforcement-posture"
          value={posture}
          disabled={busy || !canChange}
          onChange={(event) => setPosture(event.target.value as Posture)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="tolerant">Tolerant</option>
          <option value="normal">Normal</option>
          <option value="crackdown">Crackdown</option>
        </select>
        <button
          type="button"
          disabled={busy || !canChange}
          onClick={() => submit({ action: "posture", posture })}
          className="rounded border border-border px-3 py-1 disabled:opacity-50"
        >
          Set posture
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="union-enforcement-target">Investigate</label>
        <select
          id="union-enforcement-target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="">Choose a union</option>
          {unions.map((union) => (
            <option key={union.unionId} value={union.unionId}>
              {union.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !target}
          onClick={() => submit({ action: "investigate", unionId: target })}
          className="rounded border border-border px-3 py-1 disabled:opacity-50"
        >
          Investigate
        </button>
        <button
          type="button"
          disabled={busy || !target}
          onClick={() => submit({ action: "raid", unionId: target })}
          className="rounded border border-border px-3 py-1 disabled:opacity-50"
        >
          Raid
        </button>
      </div>
      {result && (
        <p role="status" className="mt-2 text-xs">
          {result}
        </p>
      )}
    </section>
  );
}
