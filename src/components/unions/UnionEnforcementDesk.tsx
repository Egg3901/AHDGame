"use client";

import { useEffect, useState } from "react";
import { apiErrorText } from "@/lib/errors/catalog";

interface TargetUnion {
  unionId: string;
  name: string;
}

type Posture = "tolerant" | "normal" | "crackdown";
interface ProsecutionTarget {
  unionId: string;
  characterId: string;
  name: string;
}

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
  const [prosecutionTargets, setProsecutionTargets] = useState<ProsecutionTarget[]>([]);
  const [prosecutionTarget, setProsecutionTarget] = useState("");
  const [exposedUnionIds, setExposedUnionIds] = useState<string[]>([]);
  const [crackdownCostPerTurn, setCrackdownCostPerTurn] = useState(0);
  const [crackdownApprovalPenalty, setCrackdownApprovalPenalty] = useState(2);
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
        setProsecutionTargets(data.prosecutionTargets ?? []);
        setExposedUnionIds(data.exposedUnionIds ?? []);
        setCrackdownCostPerTurn(data.crackdownCostPerTurn ?? 0);
        setCrackdownApprovalPenalty(data.crackdownApprovalPenalty ?? 2);
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
        setResult(apiErrorText(data, "Enforcement action failed."));
      } else if ("posture" in data) {
        setPosture(data.posture);
        setCanChange(false);
        setResult(`Enforcement posture set to ${data.posture}.`);
      } else if ("strengthLoss" in data) {
        if ("barredUntilTurn" in data) {
          setProsecutionTargets((targets) =>
            targets.filter((target) => target.characterId !== data.characterId)
          );
          setProsecutionTarget("");
          setResult(
            `Prosecution removed ${data.strengthLoss} organizer strength and barred drives through turn ${data.barredUntilTurn}. Three action points spent.`
          );
        } else {
          setResult(
            `Raid removed ${data.strengthLoss} cell strength and confiscated ${data.fineSeized ?? 0} from the frozen treasury${data.sympathyGain ? `; sympathy restored ${data.sympathyGain}` : ""}. Two action points spent. This cell cannot be raided again for three turns.`
          );
        }
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
      <h2 className="font-semibold">Government union enforcement</h2>
      <p className="mt-1 text-xs text-muted">
        Investigate a domestic union for one action point, raid an exposed or high heat cell for
        two, or change the standing detection posture once per turn.
      </p>
      <p className="mt-1 text-xs text-muted">
        Crackdown costs {crackdownCostPerTurn.toLocaleString("en-US")} from the treasury each turn
        and lowers labor approval by {crackdownApprovalPenalty} points while active.
      </p>
      <p className="mt-1 text-xs text-muted">
        Exposed cells:{" "}
        {exposedUnionIds.length
          ? exposedUnionIds
              .map((id) => unions.find((union) => union.unionId === id)?.name ?? "Union")
              .join(", ")
          : "none detected"}
        .
      </p>
      <p className="mt-1 text-xs text-muted">
        Crackdown costs the treasury 0.1% of GDP per year and reduces government approval by two
        points while active.
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
      {prosecutionTargets.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="union-prosecution-target">Prosecute exposed organizer</label>
          <select
            id="union-prosecution-target"
            value={prosecutionTarget}
            onChange={(event) => setProsecutionTarget(event.target.value)}
            className="rounded border border-border bg-background px-2 py-1"
          >
            <option value="">Choose an organizer</option>
            {prosecutionTargets.map((candidate) => (
              <option
                key={`${candidate.unionId}:${candidate.characterId}`}
                value={`${candidate.unionId}:${candidate.characterId}`}
              >
                {candidate.name} (
                {unions.find((union) => union.unionId === candidate.unionId)?.name ?? "Union"})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !prosecutionTarget}
            onClick={() => {
              const [unionId, characterId] = prosecutionTarget.split(":");
              submit({ action: "prosecute", unionId, characterId });
            }}
            className="rounded border border-border px-3 py-1 disabled:opacity-50"
          >
            Prosecute (3 AP)
          </button>
        </div>
      )}
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
