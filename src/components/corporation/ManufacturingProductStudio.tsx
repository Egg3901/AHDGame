"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, LoadingSpinner } from "@/components/ui";
import {
  allocatedManufacturingCapitalAnchor,
  manufacturingDevelopmentThresholdAnchor,
} from "@/lib/products/rules/manufacturingRules";
import { apiErrorText } from "@/lib/errors/catalog";

interface ProductKind {
  id: string;
  label: string;
  outputCommodity: string;
  technologyRequirements?: Array<{
    strategyId: string;
    strategyName: string;
    minDecade: string | null;
    requiresTechUnlock: boolean;
  }>;
}

interface ProductPlant {
  sectorId: string;
  sectorType: string;
  industryModel?: string | null;
  strategyId?: string | null;
  capitalStock: number;
  developmentCapitalAnchor?: number;
  plantCount: number;
  eligibleKindIds: string[];
}

interface ActiveProductProject {
  id: string;
  kindId: string;
  kindLabel: string;
  outputCommodity?: string;
  stage: string;
  allocations: Array<{ sectorId: string; share: number }>;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  elapsedDevelopmentTurns: number;
  elapsedThresholdTurns: number;
  advertisingAllocationShare?: number;
  developmentAdvertisingAnchor?: number;
  developmentAdvertisingTurns?: number;
  productBrand?: number;
}

interface ProductResult {
  sectorId: string;
  turn: number;
  producedUnits: number;
  soldUnits: number;
  quality: number | null;
}

interface StudioState {
  enabled: boolean;
  isCeo: boolean;
  catalog: ProductKind[];
  plants: ProductPlant[];
  activeProject: ActiveProductProject | null;
  productResults?: ProductResult[];
}

export function ManufacturingProductStudio({
  corporationId,
  onUpdate,
}: {
  corporationId: string;
  onUpdate?: () => void;
}) {
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [kindId, setKindId] = useState("");
  const [shares, setShares] = useState<Record<string, number>>({});
  const [advertisingShare, setAdvertisingShare] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStudio = useCallback(async () => {
    const response = await fetch(`/api/corporations/${corporationId}/products`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as StudioState;
  }, [corporationId]);

  const refresh = useCallback(async () => {
    try {
      const data = await loadStudio();
      if (!data) return;
      setStudio(data);
      setKindId((current) => current || data.catalog[0]?.id || "");
    } catch {
      setMessage("Product Studio could not load.");
    }
  }, [loadStudio]);

  useEffect(() => {
    let active = true;
    void loadStudio()
      .then((data) => {
        if (!active || !data) return;
        setStudio(data);
        setKindId((current) => current || data.catalog[0]?.id || "");
      })
      .catch(() => {
        if (active) setMessage("Product Studio could not load.");
      });
    return () => {
      active = false;
    };
  }, [loadStudio]);

  if (!studio) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <LoadingSpinner />
          <span>Loading Product Studio</span>
        </div>
      </Card>
    );
  }
  if (!studio.enabled) return null;

  const legalPlants = studio.plants.filter((plant) => plant.eligibleKindIds.includes(kindId));
  const allocations = legalPlants
    .map((plant) => ({ sectorId: plant.sectorId, share: shares[plant.sectorId] ?? 0 }))
    .filter((allocation) => allocation.share > 0);
  const quotedPlants = legalPlants.flatMap((plant) =>
    typeof plant.developmentCapitalAnchor === "number" &&
    Number.isFinite(plant.developmentCapitalAnchor) &&
    plant.developmentCapitalAnchor >= 0
      ? [{ sectorId: plant.sectorId, developmentCapitalAnchor: plant.developmentCapitalAnchor }]
      : []
  );
  const allSelectedPlantsQuoted = allocations.every((allocation) =>
    quotedPlants.some((plant) => plant.sectorId === allocation.sectorId)
  );
  const estimatedDevelopmentCost =
    allocations.length > 0 && allSelectedPlantsQuoted
      ? manufacturingDevelopmentThresholdAnchor(
          allocatedManufacturingCapitalAnchor(quotedPlants, allocations)
        )
      : null;
  const selectedKind = studio.catalog.find((kind) => kind.id === kindId);

  async function startProject() {
    if (!kindId || allocations.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/corporations/${corporationId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, allocations, advertisingAllocationShare: advertisingShare }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(apiErrorText(data, "Product project could not start."));
        return;
      }
      setMessage("Product development started. Paid R&D funds development until its cost is paid.");
      setShares({});
      await refresh();
      onUpdate?.();
    } catch {
      setMessage("Product project could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function retireProject() {
    const project = studio?.activeProject;
    if (!project) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/corporations/${corporationId}/products/${project.id}/retire`,
        { method: "POST" }
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(apiErrorText(data, "Project could not be retired."));
        return;
      }
      setMessage("Product project retired.");
      await refresh();
      onUpdate?.();
    } catch {
      setMessage("Project could not be retired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-5" aria-label="Manufacturing Product Studio">
      <div>
        <h2 className="text-lg font-bold text-foreground">Product Studio</h2>
        <p className="mt-1 text-sm text-muted">
          Develop one product project, allocated across owned plants. Unallocated capacity keeps its
          current strategy output. Paid R&amp;D funds development until the project cost is paid.
        </p>
      </div>
      {studio.activeProject ? (
        <div className="space-y-3 rounded border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-foreground">{studio.activeProject.kindLabel}</div>
              <div className="text-sm text-muted">
                {studio.activeProject.stage} · {studio.activeProject.outputCommodity}
              </div>
            </div>
            {studio.isCeo && (
              <Button variant="secondary" disabled={busy} onClick={retireProject}>
                Retire project
              </Button>
            )}
          </div>
          <div className="text-sm text-muted">
            Development paid {studio.activeProject.developmentPaidAnchor.toLocaleString()} of{" "}
            {studio.activeProject.paidThresholdAnchor.toLocaleString()} anchor units, with{" "}
            {studio.activeProject.elapsedDevelopmentTurns} of{" "}
            {studio.activeProject.elapsedThresholdTurns} required turns elapsed.
          </div>
          <div className="text-sm text-muted">
            Product brand: {(studio.activeProject.productBrand ?? 0).toLocaleString()} paid
            advertising anchor units per development turn. Advertising allocation:{" "}
            {((studio.activeProject.advertisingAllocationShare ?? 0) * 100).toFixed(0)}% of
            delivered marketing. Brand and paid development support the product quality and premium
            pricing.
          </div>
          <div className="space-y-1 text-sm text-muted">
            {studio.activeProject.allocations.map((allocation) => {
              const plant = studio.plants.find(
                (candidate) => candidate.sectorId === allocation.sectorId
              );
              return (
                <div key={allocation.sectorId}>
                  {plant?.sectorType ?? "Plant"}
                  {plant?.industryModel ? ` (${plant.industryModel})` : ""}:{" "}
                  {(allocation.share * 100).toFixed(0)}% capacity
                </div>
              );
            })}
          </div>
          <div className="space-y-1 text-sm text-muted" aria-label="Realized product sales">
            <div className="font-medium text-foreground">Last settled product sales</div>
            {(studio.productResults ?? []).length > 0 ? (
              (studio.productResults ?? []).map((result) => {
                const plant = studio.plants.find(
                  (candidate) => candidate.sectorId === result.sectorId
                );
                return (
                  <div key={`${result.sectorId}-${result.turn}`}>
                    {plant?.sectorType ?? "Plant"}
                    {plant?.industryModel ? ` (${plant.industryModel})` : ""}, turn {result.turn}:{" "}
                    {result.soldUnits.toLocaleString()} of {result.producedUnits.toLocaleString()}{" "}
                    units sold
                    {result.quality != null ? ` · quality ${result.quality.toFixed(1)}` : ""}
                  </div>
                );
              })
            ) : (
              <div>No settled product sales recorded yet.</div>
            )}
          </div>
          <p className="text-xs text-muted">
            Product quality starts from current plant quality, which reflects technology,
            operations, input quality, and wages. Paid development adds up to 10 points as the
            project advances; the wage-derived baseline is recalculated each turn.
          </p>
        </div>
      ) : studio.isCeo ? (
        <div className="space-y-3">
          {studio.catalog.length > 0 ? (
            <>
              <label className="block text-sm font-medium text-foreground">
                Product type
                <select
                  className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2"
                  value={kindId}
                  onChange={(event) => setKindId(event.target.value)}
                >
                  {studio.catalog.map((kind) => (
                    <option key={kind.id} value={kind.id}>
                      {kind.label} · {kind.outputCommodity}
                    </option>
                  ))}
                </select>
              </label>
              {legalPlants.map((plant) => (
                <label
                  key={plant.sectorId}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="text-foreground">
                    {plant.sectorType}
                    {plant.industryModel ? ` (${plant.industryModel})` : ""} ·{" "}
                    {plant.strategyId ?? "standard"} · {plant.capitalStock.toLocaleString()}{" "}
                    capacity
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    <input
                      aria-label={`${plant.sectorType} allocation`}
                      className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-foreground"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      value={((shares[plant.sectorId] ?? 0) * 100).toString()}
                      onChange={(event) =>
                        setShares((current) => ({
                          ...current,
                          [plant.sectorId]: Math.max(
                            0,
                            Math.min(1, Number(event.target.value) / 100)
                          ),
                        }))
                      }
                    />
                    %
                  </span>
                </label>
              ))}
              {selectedKind && (
                <div className="space-y-2 rounded border border-border p-3 text-sm text-muted">
                  {estimatedDevelopmentCost != null && (
                    <div>
                      Estimated development cost: {estimatedDevelopmentCost.toLocaleString()} anchor
                      units (5% of allocated monetary plant capital, one-unit minimum).
                    </div>
                  )}
                  <div>
                    Quality starts from live plant quality: technology, operations, input quality,
                    and wages. Paid development adds up to 10 points as the project advances.
                  </div>
                  <div>
                    Technology requirements are carried by the eligible plant strategy:
                    {selectedKind.technologyRequirements?.length ? (
                      <ul className="mt-1 list-disc pl-5">
                        {selectedKind.technologyRequirements.map((requirement) => (
                          <li key={`${requirement.strategyId}-${requirement.minDecade ?? "base"}`}>
                            {requirement.strategyName}
                            {requirement.minDecade
                              ? `, available from ${requirement.minDecade}`
                              : ""}
                            {requirement.requiresTechUnlock
                              ? ", requires its technology unlock"
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      " no additional technology gates."
                    )}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted">
                Product advertising allocation
                <input
                  aria-label="Product advertising allocation"
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={advertisingShare * 100}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-foreground"
                  onChange={(event) =>
                    setAdvertisingShare(Math.max(0, Math.min(1, Number(event.target.value) / 100)))
                  }
                />
                % of delivered marketing during development
              </label>
              <p className="text-sm text-muted">
                Only paid delivered advertising builds product brand. Media and manufacturing
                products share the existing marketing budget.
              </p>
              <Button disabled={busy || allocations.length === 0} onClick={startProject}>
                Start product project
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">
              No owned plant currently has an eligible product strategy.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">The CEO manages product development.</p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </Card>
  );
}
