"use client";

import type { Dispatch } from "react";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationsAdminAction, CorporationsAdminState } from "../useCorporationsAdminState";

export function SpawnNppPanel({
  spawnNppForm,
  spawnNppResult,
  spawnNppLoading,
  dispatch,
  fetchData,
}: {
  spawnNppForm: CorporationsAdminState["spawnNppForm"];
  spawnNppResult: CorporationsAdminState["spawnNppResult"];
  spawnNppLoading: boolean;
  dispatch: Dispatch<CorporationsAdminAction>;
  fetchData: () => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Spawn NPP Corporation</h3>
      <p className="text-xs text-muted">
        Create a non-player-purchasable corporation. It will have no CEO, no user owner, and will
        participate in turn processing. Starting revenue is captured from the unowned market (20% of
        the sector&apos;s unowned revenue).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted">Name</label>
          <input
            type="text"
            value={spawnNppForm.name}
            onChange={(e) =>
              dispatch({ type: "SET_SPAWN_NPP_FORM", value: { name: e.target.value } })
            }
            placeholder="e.g. Acme Industries"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Type</label>
          <select
            value={spawnNppForm.type}
            onChange={(e) =>
              dispatch({ type: "SET_SPAWN_NPP_FORM", value: { type: e.target.value } })
            }
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          >
            {Object.entries(CORPORATION_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Country</label>
          <select
            value={spawnNppForm.countryId}
            onChange={(e) =>
              dispatch({ type: "SET_SPAWN_NPP_FORM", value: { countryId: e.target.value } })
            }
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          >
            {["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">HQ State ID</label>
          <input
            type="text"
            value={spawnNppForm.headquartersState}
            onChange={(e) =>
              dispatch({
                type: "SET_SPAWN_NPP_FORM",
                value: { headquartersState: e.target.value },
              })
            }
            placeholder="e.g. CA, england, JP-13"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Starting Capital</label>
          <input
            type="number"
            value={spawnNppForm.startingCapital}
            onChange={(e) =>
              dispatch({
                type: "SET_SPAWN_NPP_FORM",
                value: { startingCapital: e.target.value },
              })
            }
            placeholder="1000000"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Starting Revenue (optional)</label>
          <input
            type="number"
            value={spawnNppForm.startingRevenue}
            onChange={(e) =>
              dispatch({
                type: "SET_SPAWN_NPP_FORM",
                value: { startingRevenue: e.target.value },
              })
            }
            placeholder="Leave empty to auto-capture from unowned market"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Profit Margin %</label>
          <input
            type="number"
            value={spawnNppForm.profitMargin}
            onChange={(e) =>
              dispatch({ type: "SET_SPAWN_NPP_FORM", value: { profitMargin: e.target.value } })
            }
            placeholder="35"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Brand Color (optional)</label>
          <input
            type="text"
            value={spawnNppForm.brandColor}
            onChange={(e) =>
              dispatch({ type: "SET_SPAWN_NPP_FORM", value: { brandColor: e.target.value } })
            }
            placeholder="#3b82f6"
            className="w-full rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
      </div>

      {spawnNppResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            spawnNppResult.success
              ? "bg-success/10 border border-success/30"
              : "bg-error/10 border border-error/30"
          }`}
        >
          {spawnNppResult.success ? (
            <div className="space-y-1">
              <p className="text-success font-medium">
                Spawned #{spawnNppResult.sequentialId}: {spawnNppResult.name}
              </p>
              <p className="text-xs text-muted">Corp ID: {spawnNppResult.corporationId}</p>
            </div>
          ) : (
            <p className="text-error">{spawnNppResult.error}</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={async () => {
            dispatch({ type: "SET_SPAWN_NPP_LOADING", value: true });
            dispatch({ type: "SET_SPAWN_NPP_RESULT", value: null });
            dispatch({ type: "SET_ACTION_ERROR", value: null });
            try {
              const body: Record<string, unknown> = {
                name: spawnNppForm.name,
                type: spawnNppForm.type,
                countryId: spawnNppForm.countryId,
                headquartersState: spawnNppForm.headquartersState,
              };
              const capital = parseInt(spawnNppForm.startingCapital, 10);
              if (!isNaN(capital)) body.startingCapital = capital;
              const revenue = parseInt(spawnNppForm.startingRevenue, 10);
              if (!isNaN(revenue)) body.startingRevenue = revenue;
              const margin = parseFloat(spawnNppForm.profitMargin);
              if (!isNaN(margin)) body.profitMargin = margin;
              if (spawnNppForm.brandColor) body.brandColor = spawnNppForm.brandColor;

              const res = await fetch("/api/admin/corporations/spawn-npp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const json = (await res.json()) as {
                success?: boolean;
                corporationId?: string;
                sequentialId?: number;
                name?: string;
                error?: string;
              };
              if (!res.ok) {
                dispatch({
                  type: "SET_SPAWN_NPP_RESULT",
                  value: { success: false, error: json.error ?? `HTTP ${res.status}` },
                });
              } else {
                dispatch({
                  type: "SET_SPAWN_NPP_RESULT",
                  value: {
                    success: true,
                    corporationId: json.corporationId,
                    sequentialId: json.sequentialId,
                    name: json.name,
                  },
                });
                await fetchData();
              }
            } catch (e) {
              dispatch({
                type: "SET_SPAWN_NPP_RESULT",
                value: {
                  success: false,
                  error: e instanceof Error ? e.message : "Failed to spawn corporation",
                },
              });
            } finally {
              dispatch({ type: "SET_SPAWN_NPP_LOADING", value: false });
            }
          }}
          disabled={
            spawnNppLoading || !spawnNppForm.name.trim() || !spawnNppForm.headquartersState.trim()
          }
          className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {spawnNppLoading ? "Spawning…" : "Spawn Corporation"}
        </button>
        <button
          onClick={async () => {
            dispatch({ type: "SET_SPAWN_NPP_LOADING", value: true });
            dispatch({ type: "SET_SPAWN_NPP_RESULT", value: null });
            dispatch({ type: "SET_ACTION_ERROR", value: null });
            try {
              const body: Record<string, unknown> = {
                countryId: spawnNppForm.countryId,
              };
              const capital = parseInt(spawnNppForm.startingCapital, 10);
              if (!isNaN(capital)) body.startingCapital = capital;
              if (spawnNppForm.headquartersState.trim()) {
                body.headquartersState = spawnNppForm.headquartersState.trim();
              }

              const res = await fetch("/api/admin/corporations/spawn-npp-batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              const json = (await res.json()) as {
                success?: boolean;
                spawned?: number;
                corporations?: Array<{ name: string; corporationId: string; type: string }>;
                error?: string;
              };
              if (!res.ok) {
                dispatch({
                  type: "SET_SPAWN_NPP_RESULT",
                  value: { success: false, error: json.error ?? `HTTP ${res.status}` },
                });
              } else {
                dispatch({
                  type: "SET_SPAWN_NPP_RESULT",
                  value: {
                    success: true,
                    corporationId: `${json.spawned ?? 0} corps`,
                    name: json.corporations?.map((c) => c.name).join(", ") ?? "",
                  },
                });
                await fetchData();
              }
            } catch (e) {
              dispatch({
                type: "SET_SPAWN_NPP_RESULT",
                value: {
                  success: false,
                  error: e instanceof Error ? e.message : "Failed to batch spawn",
                },
              });
            } finally {
              dispatch({ type: "SET_SPAWN_NPP_LOADING", value: false });
            }
          }}
          disabled={spawnNppLoading || !spawnNppForm.countryId}
          className="text-xs px-3 py-1.5 rounded bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {spawnNppLoading ? "Spawning…" : "Batch Spawn All Sectors"}
        </button>
        <button
          onClick={() => {
            dispatch({ type: "SET_INLINE", value: null });
            dispatch({ type: "SET_SPAWN_NPP_RESULT", value: null });
          }}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
