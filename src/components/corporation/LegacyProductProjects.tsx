"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { apiErrorText } from "@/lib/errors/catalog";

interface LegacyProject {
  key: string;
  label: string;
  stage: string;
  retireUrl: string;
}

/**
 * Product projects started before the product studio keep running until they
 * retire. They can no longer be started, so this only lists and retires them.
 */
export function LegacyProductProjects({ corporationId }: { corporationId: string }) {
  const [projects, setProjects] = useState<LegacyProject[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const found: LegacyProject[] = [];
    const media = await fetch(`/api/corporations/${corporationId}/media-products`, {
      cache: "no-store",
    }).catch((error: unknown) => {
      console.error("[LegacyProductProjects] media projects failed to load", error);
      return null;
    });
    if (media?.ok) {
      const data = (await media.json()) as {
        enabled?: boolean;
        projects?: Array<{ _id: string; title: string; kindLabel: string; stage: string }>;
      };
      for (const project of data.projects ?? []) {
        if (project.stage === "retired") continue;
        found.push({
          key: `media-${project._id}`,
          label: `${project.title} (${project.kindLabel})`,
          stage: project.stage,
          retireUrl: `/api/corporations/${corporationId}/media-products/${project._id}/retire`,
        });
      }
    }
    const manufacturing = await fetch(`/api/corporations/${corporationId}/products`, {
      cache: "no-store",
    }).catch((error: unknown) => {
      console.error("[LegacyProductProjects] product projects failed to load", error);
      return null;
    });
    if (manufacturing?.ok) {
      const data = (await manufacturing.json()) as {
        activeProject?: { id: string; kindLabel: string; stage: string } | null;
      };
      const project = data.activeProject;
      if (project && project.stage !== "retired") {
        found.push({
          key: `mfg-${project.id}`,
          label: project.kindLabel,
          stage: project.stage,
          retireUrl: `/api/corporations/${corporationId}/products/${project.id}/retire`,
        });
      }
    }
    return found;
  }, [corporationId]);

  useEffect(() => {
    let active = true;
    void load().then((found) => {
      if (active) setProjects(found);
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function retire(project: LegacyProject) {
    setMessage("");
    const response = await fetch(project.retireUrl, { method: "POST" });
    if (!response.ok) {
      setMessage(apiErrorText(await response.json().catch(() => ({})), "Could not retire it."));
      return;
    }
    setProjects(await load());
  }

  if (projects.length === 0) return null;
  return (
    <Card title="Earlier product projects">
      <p className="text-sm text-muted">
        These started before the product studio and keep running until they retire. New products are
        started in the studio above.
      </p>
      {message && (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {message}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {projects.map((project) => (
          <li key={project.key} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {project.label} <span className="text-muted">({project.stage})</span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void retire(project)}>
              Retire
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
