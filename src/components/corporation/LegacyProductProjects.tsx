"use client";

import { useCallback, useEffect, useState } from "react";
import { DenseSection, InlineStatus, SmallButton, TableScroll, Td, Th } from "./dense/DenseKit";
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
    <DenseSection title="Earlier product projects" meta="started before the product studio">
      <p className="py-1 text-sm text-muted">
        These keep running until they retire and cannot be restarted. Start new products in the
        studio above.
      </p>
      <InlineStatus message={message} tone="error" className="py-1" />
      <TableScroll>
        <table className="w-full text-sm" aria-label="Earlier product projects">
          <thead>
            <tr>
              <Th>Project</Th>
              <Th>Stage</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.key}>
                <Td numeric={false} wrap>
                  {project.label}
                </Td>
                <Td numeric={false} className="capitalize text-muted">
                  {project.stage.replace(/_/g, " ")}
                </Td>
                <Td align="right" numeric={false}>
                  <SmallButton
                    onClick={() => void retire(project)}
                    title="Stops the project. It cannot be restarted."
                  >
                    Retire
                  </SmallButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </DenseSection>
  );
}
