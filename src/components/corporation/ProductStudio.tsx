"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  SectionLabel,
} from "@/components/ui";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { MEDIA_OPERATING_MODELS } from "@/lib/products/types";

export interface StudioCatalogKind {
  id: string;
  family: string;
  label: string;
  outputCommodity: string;
  operatingModels?: string[];
  minDecade?: string;
  requiredTechnologyIds?: string[];
  cadence?: {
    developmentTurns: number;
    launchTurns: number;
    growthTurns: number;
    matureTurns: number;
    declineTurns: number;
    tail: string;
    tailBlurb: string;
  };
}

export interface StudioModelProfile {
  model: string;
  corporationTypes: string[];
  coverage: {
    pattern: string;
    addressableShare: number;
    blurb: string;
  };
  minDecade?: string;
  technologyIdBySector?: Record<string, string>;
  cadenceBlurb: string;
  tailBlurb: string;
  kinds: { id: string; label: string }[];
}

export interface StudioExplainer {
  quality: string;
  brand: string;
  coverage: string;
  tail: string;
}

export interface StudioActiveProduct {
  id: string;
  kindId: string;
  kindLabel: string;
  name: string;
  stage: string;
  startedTurn: number;
  launchedTurn?: number;
  retiredTurn?: number;
}

export interface StudioState {
  enabled: boolean;
  family: "media_entertainment" | "industrial_manufacturing" | null;
  isCeo: boolean;
  operatingModels: string[];
  activeProduct: StudioActiveProduct | null;
  catalog: StudioCatalogKind[];
  modelProfiles?: StudioModelProfile[];
  explainer?: StudioExplainer;
}

interface ProductStudioProps {
  corpId: string;
  onUpdate?: () => void;
}

function formatModel(model: string): string {
  return model
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function ProductStudio({ corpId, onUpdate }: ProductStudioProps) {
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [startingKind, setStartingKind] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(MEDIA_OPERATING_MODELS[0]);
  const [confirmingRetire, setConfirmingRetire] = useState(false);
  const [retiring, setRetiring] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/products`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load the Product Studio");
        return;
      }
      setStudio(data as StudioState);
    } catch {
      setError("Network error while loading the Product Studio");
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, StudioCatalogKind[]>();
    for (const kind of studio?.catalog ?? []) {
      const list = groups.get(kind.outputCommodity) ?? [];
      list.push(kind);
      groups.set(kind.outputCommodity, list);
    }
    return [...groups.entries()];
  }, [studio]);

  async function handleAddModel(e: React.FormEvent) {
    e.preventDefault();
    setAddingModel(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/corporations/${corpId}/operating-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatingModel: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Could not add this operating model" });
        return;
      }
      setNotice({
        type: "success",
        text: data.idempotent
          ? `${formatModel(selectedModel)} was already part of this corporation`
          : `${formatModel(selectedModel)} added to this corporation`,
      });
      await refresh();
      onUpdate?.();
    } catch {
      setNotice({ type: "error", text: "Network error while adding the operating model" });
    } finally {
      setAddingModel(false);
    }
  }

  async function handleStart(kindId: string) {
    const name = (names[kindId] ?? "").trim();
    if (name.length < 2) {
      setNotice({ type: "error", text: "Give the product a name of at least 2 characters" });
      return;
    }
    setStartingKind(kindId);
    setNotice(null);
    try {
      const res = await fetch(`/api/corporations/${corpId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Could not start this product" });
        return;
      }
      setNotice({ type: "success", text: `"${name}" entered development` });
      setNames((prev) => ({ ...prev, [kindId]: "" }));
      await refresh();
      onUpdate?.();
    } catch {
      setNotice({ type: "error", text: "Network error while starting the product" });
    } finally {
      setStartingKind(null);
    }
  }

  async function handleRetire() {
    if (!studio?.activeProduct) return;
    setRetiring(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/corporations/${corpId}/products/${studio.activeProduct.id}/retire`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error || "Could not retire this product" });
        return;
      }
      setNotice({ type: "success", text: `"${studio.activeProduct.name}" retired` });
      setConfirmingRetire(false);
      await refresh();
      onUpdate?.();
    } catch {
      setNotice({ type: "error", text: "Network error while retiring the product" });
    } finally {
      setRetiring(false);
    }
  }

  if (loading && !studio) {
    return (
      <div className="flex items-center gap-2 py-8" aria-label="Loading Product Studio">
        <LoadingSpinner />
        <span className="text-sm text-muted">Loading the Product Studio</span>
      </div>
    );
  }

  if (error && !studio) {
    return (
      <Card title="Product Studio">
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!studio) return null;

  if (!studio.enabled) {
    return (
      <Card title="Product Studio">
        <EmptyState
          title="Product Studio is not launched yet"
          description="Branded products open once the world enables corporation products. Sectors, contracts, and markets are unaffected."
        />
      </Card>
    );
  }

  const canAct = studio.isCeo;
  const hasActive = studio.activeProduct !== null;
  const usesOperatingModels = studio.family === "media_entertainment";

  return (
    <div className="space-y-4">
      <div aria-live="polite">
        {notice && (
          <p
            role="status"
            className={`text-sm ${notice.type === "error" ? "text-error" : "text-success"}`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {usesOperatingModels && (
        <Card
          title="Operating models"
          action={<Badge color="secondary">{studio.operatingModels.length}</Badge>}
        >
          {studio.operatingModels.length === 0 ? (
            <p className="text-sm text-muted">
              This corporation owns no operating models yet. Media products unlock once a model is
              added.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Owned operating models">
              {studio.operatingModels.map((model) => (
                <li key={model}>
                  <Badge color="primary">{formatModel(model)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {canAct && (
            <form
              onSubmit={(e) => void handleAddModel(e)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <div>
                <label
                  htmlFor="product-studio-model"
                  className="mb-1 block text-xs font-medium text-muted"
                >
                  Add an operating model
                </label>
                <select
                  id="product-studio-model"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="h-9 rounded-lg border border-card-border bg-card px-2.5 text-[13px] text-foreground"
                >
                  {MEDIA_OPERATING_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {formatModel(model)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="secondary" size="sm" isLoading={addingModel}>
                Add model
              </Button>
            </form>
          )}
        </Card>
      )}

      {usesOperatingModels && (studio.explainer || (studio.modelProfiles ?? []).length > 0) && (
        <Card title="How content products work">
          {studio.explainer && (
            <ul className="space-y-1 text-sm text-muted" aria-label="Product rules">
              <li>Quality: {studio.explainer.quality}</li>
              <li>Brand: {studio.explainer.brand}</li>
              <li>Coverage: {studio.explainer.coverage}</li>
              <li>Tail: {studio.explainer.tail}</li>
            </ul>
          )}
          {(studio.modelProfiles ?? []).length > 0 && (
            <ul className="mt-3 space-y-3" aria-label="Operating model details">
              {(studio.modelProfiles ?? []).map((profile) => (
                <li
                  key={profile.model}
                  className="rounded-lg border border-card-border p-3"
                  aria-label={formatModel(profile.model)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {formatModel(profile.model)}
                    </span>
                    <span className="text-xs text-muted">
                      {Math.round(profile.coverage.addressableShare * 100)}% reach
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{profile.coverage.blurb}</p>
                  <p className="mt-1 text-xs text-muted">{profile.cadenceBlurb}</p>
                  <p className="mt-1 text-xs text-muted">{profile.tailBlurb}</p>
                  <p className="mt-1 text-xs text-muted">
                    Requires:{" "}
                    {[
                      `a ${profile.corporationTypes.map(formatModel).join(" or ")} corporation`,
                      profile.minDecade ? `the ${profile.minDecade}s` : null,
                      profile.technologyIdBySector
                        ? Object.values(profile.technologyIdBySector).join(", ")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "nothing beyond the model"}
                    . Makes: {profile.kinds.map((kind) => kind.label).join(", ") || "nothing yet"}.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Active product">
        {!studio.activeProduct ? (
          <p className="text-sm text-muted">
            No active product. Start one from the catalog below
            {canAct ? "" : ", once the CEO starts it"}.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{studio.activeProduct.name}</span>
              <Badge color="info">{studio.activeProduct.kindLabel}</Badge>
              <Badge color={studio.activeProduct.stage === "retired" ? "default" : "success"}>
                {studio.activeProduct.stage}
              </Badge>
            </div>
            <p className="text-sm text-muted">Started on turn {studio.activeProduct.startedTurn}</p>
            {canAct &&
              (confirmingRetire ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Retire this product and free the slot?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    isLoading={retiring}
                    onClick={() => void handleRetire()}
                    aria-label={`Confirm retirement of ${studio.activeProduct.name}`}
                  >
                    Confirm retire
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingRetire(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => setConfirmingRetire(true)}>
                  Retire product
                </Button>
              ))}
          </div>
        )}
      </Card>

      <Card
        title="Product catalog"
        action={<Badge color="secondary">{studio.catalog.length}</Badge>}
      >
        {studio.catalog.length === 0 ? (
          <EmptyState
            title="No legal products yet"
            description={
              usesOperatingModels && canAct
                ? "Add an operating model above to unlock media products."
                : usesOperatingModels
                  ? "This corporation owns no operating models, so no media product is legal yet."
                  : "No products are available for this industrial corporation yet."
            }
          />
        ) : (
          <div className="space-y-5">
            {groupedCatalog.map(([output, kinds]) => (
              <section key={output} aria-label={`${output} products`}>
                <SectionLabel>
                  {(COMMODITY_LABELS as Record<string, string>)[output] ?? output}
                </SectionLabel>
                <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                  {kinds.map((kind) => (
                    <li
                      key={kind.id}
                      className="rounded-lg border border-card-border p-3"
                      aria-label={kind.label}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{kind.label}</span>
                        <Badge color="default">{kind.family}</Badge>
                      </div>
                      {kind.operatingModels && (
                        <p className="mt-1 text-xs text-muted">
                          Needs: {kind.operatingModels.map(formatModel).join(", ")}
                        </p>
                      )}
                      {canAct &&
                        (hasActive ? (
                          <p className="mt-2 text-xs text-muted">
                            One active product at a time. Retire it to start another.
                          </p>
                        ) : (
                          <form
                            className="mt-2 flex flex-wrap items-end gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleStart(kind.id);
                            }}
                          >
                            <div className="min-w-32 flex-1">
                              <label
                                htmlFor={`product-name-${kind.id}`}
                                className="mb-1 block text-xs font-medium text-muted"
                              >
                                Product name for {kind.label}
                              </label>
                              <Input
                                id={`product-name-${kind.id}`}
                                value={names[kind.id] ?? ""}
                                onChange={(e) =>
                                  setNames((prev) => ({ ...prev, [kind.id]: e.target.value }))
                                }
                                placeholder="Model One"
                                maxLength={60}
                              />
                            </div>
                            <Button
                              type="submit"
                              variant="primary"
                              size="sm"
                              isLoading={startingKind === kind.id}
                              aria-label={`Start ${kind.label}`}
                            >
                              Start
                            </Button>
                          </form>
                        ))}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {!canAct && (
          <p className="mt-3 text-xs text-muted">Only the CEO can add models or start products.</p>
        )}
      </Card>
    </div>
  );
}
