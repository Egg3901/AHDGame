"use client";

import { OPERATING_SECTOR_TYPE_LABELS } from "@/lib/constants/corporations";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, LoadingSpinner } from "@/components/ui";
import { apiErrorText } from "@/lib/errors/catalog";

interface MediaKind {
  id: string;
  modelId: string;
  label: string;
  coverage: number;
  durations: Partial<Record<string, number>>;
  tail: string;
  eligibleSectorIds: string[];
}

interface MediaSector {
  id: string;
  strategyId?: string | null;
  operatingSectorType: "media" | "media_entertainment";
  capitalStock: number;
}

interface MediaProject {
  _id: string;
  kindId: string;
  kindLabel: string;
  title: string;
  sectorId: string;
  allocationShare: number;
  stage: string;
  developmentPaidAnchor: number;
  paidThresholdAnchor: number;
  elapsedDevelopmentTurns: number;
  elapsedThresholdTurns: number;
  launchQuality?: number;
  productBrand?: number;
}

interface StudioState {
  enabled: boolean;
  isCeo: boolean;
  currentTurn: number;
  catalog: MediaKind[];
  sectors: MediaSector[];
  projects: MediaProject[];
}

export function MediaProductStudio({
  corporationId,
  onUpdate,
}: {
  corporationId: string;
  onUpdate?: () => void;
}) {
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [kindId, setKindId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [title, setTitle] = useState("");
  const [allocationShare, setAllocationShare] = useState(0.25);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/corporations/${corporationId}/media-products`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as StudioState;
      setStudio(data);
      setKindId((current) => current || data.catalog[0]?.id || "");
      setSectorId((current) => current || data.catalog[0]?.eligibleSectorIds[0] || "");
    } catch {
      setMessage("Media Product Studio could not load.");
    }
  }, [corporationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedKind = studio?.catalog.find((kind) => kind.id === kindId);
  const eligibleSectors =
    studio?.sectors.filter((sector) => selectedKind?.eligibleSectorIds.includes(sector.id)) ?? [];

  async function startProject() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/corporations/${corporationId}/media-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, sectorId, title, allocationShare }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(apiErrorText(body, "Could not start the project."));
      setTitle("");
      setMessage(
        "Development started. Paid research and delivered advertising count during turns."
      );
      await refresh();
      onUpdate?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the project.");
    } finally {
      setBusy(false);
    }
  }

  async function retireProject(projectId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/corporations/${corporationId}/media-products/${projectId}/retire`,
        { method: "POST" }
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(apiErrorText(body, "Could not retire the project."));
      await refresh();
      onUpdate?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retire the project.");
    } finally {
      setBusy(false);
    }
  }

  if (!studio)
    return (
      <Card>
        <LoadingSpinner />
      </Card>
    );
  if (!studio.enabled) return null;

  const activeDevelopment = studio.projects.find((project) => project.stage === "development");
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-lg font-semibold">Media product studio</h3>
        <p className="text-sm text-muted-foreground">
          Develop named titles with paid research. Titles use existing sector output and never add
          units.
        </p>
      </div>
      {studio.projects.length > 0 && (
        <div className="space-y-3">
          {studio.projects.map((project) => (
            <div
              key={project._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
            >
              <div>
                <div className="font-medium">
                  {project.title}{" "}
                  <span className="text-muted-foreground">({project.kindLabel})</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {project.stage} · research {Math.round(project.developmentPaidAnchor)} /{" "}
                  {Math.round(project.paidThresholdAnchor)} · {project.elapsedDevelopmentTurns} /{" "}
                  {project.elapsedThresholdTurns} development turns
                  {project.launchQuality != null ? ` · quality ${project.launchQuality}` : ""}
                  {project.productBrand != null
                    ? ` · brand ${Math.round(project.productBrand)}`
                    : ""}
                </div>
              </div>
              {project.stage === "development" && studio.isCeo && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void retireProject(project._id)}
                >
                  Retire project
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {studio.isCeo && !activeDevelopment && studio.catalog.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Title type</span>
            <select
              className="w-full rounded border bg-background p-2"
              value={kindId}
              onChange={(event) => {
                const kind = studio.catalog.find((item) => item.id === event.target.value);
                setKindId(event.target.value);
                setSectorId(kind?.eligibleSectorIds[0] ?? "");
              }}
            >
              {studio.catalog.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Operating model</span>
            <select
              className="w-full rounded border bg-background p-2"
              value={sectorId}
              onChange={(event) => setSectorId(event.target.value)}
            >
              {eligibleSectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.strategyId} ({OPERATING_SECTOR_TYPE_LABELS[sector.operatingSectorType]})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Title name</span>
            <input
              className="w-full rounded border bg-background p-2"
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Share of existing output</span>
            <input
              className="w-full rounded border bg-background p-2"
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={allocationShare}
              onChange={(event) => setAllocationShare(Number(event.target.value))}
            />
          </label>
          <div className="sm:col-span-2">
            <Button
              disabled={busy || !kindId || !sectorId || !title.trim()}
              onClick={() => void startProject()}
            >
              {busy ? "Working..." : "Start paid development"}
            </Button>
          </div>
        </div>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </Card>
  );
}
