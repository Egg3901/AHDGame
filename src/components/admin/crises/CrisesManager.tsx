"use client";

import { useEffect, useState, useCallback } from "react";
import type { Crisis } from "@/lib/db/types/crisis";
import type { AutoCooldownRow, AutoTemplate, FormState } from "./crisisAdminTypes";
import { makeEmptyForm } from "./crisisAdminTypes";
import { CrisesHeaderBar } from "./CrisesHeaderBar";
import { CrisesTable } from "./CrisesTable";
import { AutoCrisisPanel } from "./AutoCrisisPanel";
import { CreateCrisisModal } from "./CreateCrisisModal";
import { CreateFromTemplateModal } from "./CreateFromTemplateModal";

export function CrisesManager() {
  const [crises, setCrises] = useState<Crisis[]>([]);
  const [startingYear, setStartingYear] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(makeEmptyForm());
  const [submitting, setSubmitting] = useState(false);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateTargetCountries, setTemplateTargetCountries] = useState<string[]>([]);
  const [templateRegionIds, setTemplateRegionIds] = useState<string>("");
  const [templateDuration, setTemplateDuration] = useState<string>("");
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  // `null` until the first fetch resolves, so the toggle doesn't flash a
  // misleading "Off" before the real flag state loads.
  const [interactionEnabled, setInteractionEnabled] = useState<boolean | null>(null);
  const [togglingFlag, setTogglingFlag] = useState(false);
  // `null` until the first fetch resolves (same flash-avoidance as above).
  const [autoDisastersEnabled, setAutoDisastersEnabled] = useState<boolean | null>(null);
  const [togglingDisasters, setTogglingDisasters] = useState(false);
  const [autoCrisisPaused, setAutoCrisisPaused] = useState<boolean | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [autoTemplates, setAutoTemplates] = useState<AutoTemplate[]>([]);
  const [autoCooldowns, setAutoCooldowns] = useState<AutoCooldownRow[]>([]);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [reseeding, setReseeding] = useState(false);

  const fetchCrises = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/crises");
      if (res.ok) {
        const data = await res.json();
        setCrises(data.crises ?? []);
        setStartingYear(data.startingYear);
        setInteractionEnabled(data.interactionEnabled === true);
        setAutoDisastersEnabled(data.autoDisastersEnabled === true);
        setAutoCrisisPaused(data.autoCrisisPaused === true);
        setAutoTemplates(data.autoTemplates ?? []);
        setAutoCooldowns(data.autoCooldowns ?? []);
        setCurrentTurn(typeof data.currentTurn === "number" ? data.currentTurn : null);
      }
    } catch {
      setMessage("Failed to fetch crises");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCrises();
  }, [fetchCrises]);

  const handleResolve = async (id: string) => {
    if (!confirm("Resolve this crisis early?")) return;
    const res = await fetch(`/api/admin/crises/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve" }),
    });
    if (res.ok) {
      setMessage("Crisis resolved");
      fetchCrises();
    } else {
      setMessage("Failed to resolve");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this crisis permanently?")) return;
    const res = await fetch(`/api/admin/crises/${id}`, { method: "DELETE" });
    if (res.ok) {
      setMessage("Crisis deleted");
      fetchCrises();
    } else {
      setMessage("Failed to delete");
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        scope: form.scope,
        countryIds: form.countryIds,
        regionIds: form.regionIds,
        durationTurns: form.durationFixed ? parseInt(form.durationTurns, 10) : null,
        wireMessageOnStart: form.wireMessageOnStart || form.name,
        wireMessageOnEnd: form.wireMessageOnEnd || null,
        effects: form.effects.map((e) => ({
          ...e,
          value: parseFloat(e.value) || 0,
        })),
      };
      const res = await fetch("/api/admin/crises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Crisis created");
        setShowModal(false);
        setForm(makeEmptyForm());
        fetchCrises();
      } else {
        setMessage(data.error ?? "Failed to create crisis");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePause = async () => {
    const next = !autoCrisisPaused;
    setTogglingPause(true);
    try {
      const res = await fetch("/api/admin/crises/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoCrisisPaused(data.autoCrisisPaused === true);
        setMessage(data.autoCrisisPaused ? "Crisis spawning paused" : "Crisis spawning resumed");
      } else {
        setMessage(data.error ?? "Failed to toggle pause");
      }
    } catch {
      setMessage("Failed to toggle pause");
    } finally {
      setTogglingPause(false);
    }
  };

  const handleReseedImages = async () => {
    if (
      !confirm(
        "Backfill hero images on all crises from the current template catalog?\n\n" +
          "Crises are matched by name. Manual crises with no matching template are skipped."
      )
    )
      return;
    setReseeding(true);
    try {
      const res = await fetch("/api/admin/crises/reseed", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const unmatched =
          Array.isArray(data.unmatched) && data.unmatched.length > 0
            ? ` (${data.unmatched.length} unmatched: ${data.unmatched.join(", ")})`
            : "";
        setMessage(`${data.message ?? "Hero images reseeded"}${unmatched}`);
        fetchCrises();
      } else {
        setMessage(data.error ?? "Failed to reseed crisis images");
      }
    } catch {
      setMessage("Failed to reseed crisis images");
    } finally {
      setReseeding(false);
    }
  };

  const handleToggleAutoDisasters = async () => {
    const next = !autoDisastersEnabled;
    if (
      !confirm(
        `${next ? "Enable" : "Disable"} the automatic crisis system?\n\n` +
          "Master switch for BOTH regional disasters (one per country every 144 turns, " +
          "applying a decaying corporate margin penalty) AND economic/political auto-crises " +
          "(metric-triggered recessions, inflation spikes, etc., plus random shocks)."
      )
    )
      return;
    setTogglingDisasters(true);
    try {
      const res = await fetch("/api/admin/auto-disasters/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoDisastersEnabled(data.autoDisastersEnabled === true);
        setMessage(
          data.autoDisastersEnabled
            ? "Automatic natural disasters enabled"
            : "Automatic natural disasters disabled"
        );
      } else {
        setMessage(data.error ?? "Failed to toggle automatic natural disasters");
      }
    } catch {
      setMessage("Failed to toggle automatic natural disasters");
    } finally {
      setTogglingDisasters(false);
    }
  };

  const handleToggleInteraction = async () => {
    const next = !interactionEnabled;
    if (!confirm(`${next ? "Enable" : "Disable"} the crisis interaction system?`)) return;
    setTogglingFlag(true);
    try {
      const res = await fetch("/api/admin/crises/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setInteractionEnabled(data.crisisInteractionEnabled === true);
        setMessage(
          data.crisisInteractionEnabled
            ? "Crisis interaction system enabled"
            : "Crisis interaction system disabled"
        );
      } else {
        setMessage(data.error ?? "Failed to toggle crisis interaction system");
      }
    } catch {
      setMessage("Failed to toggle crisis interaction system");
    } finally {
      setTogglingFlag(false);
    }
  };

  const handleTemplateSubmit = async () => {
    if (!selectedTemplate) return;
    setTemplateSubmitting(true);
    try {
      const body: Record<string, unknown> = { templateKey: selectedTemplate };
      if (templateTargetCountries.length > 0) body.countryIds = templateTargetCountries;
      if (templateRegionIds)
        body.regionIds = templateRegionIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const parsedDuration = parseInt(templateDuration, 10);
      if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
        body.durationTurns = parsedDuration;
      }

      const res = await fetch("/api/admin/crises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Crisis created from template");
        setShowTemplateModal(false);
        setSelectedTemplate("");
        setTemplateTargetCountries([]);
        setTemplateRegionIds("");
        setTemplateDuration("");
        fetchCrises();
      } else {
        setMessage(data.error ?? "Failed to create from template");
      }
    } finally {
      setTemplateSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <CrisesHeaderBar
        interactionEnabled={interactionEnabled}
        togglingFlag={togglingFlag}
        autoDisastersEnabled={autoDisastersEnabled}
        togglingDisasters={togglingDisasters}
        autoCrisisPaused={autoCrisisPaused}
        togglingPause={togglingPause}
        reseeding={reseeding}
        onToggleInteraction={handleToggleInteraction}
        onToggleAutoDisasters={handleToggleAutoDisasters}
        onTogglePause={handleTogglePause}
        onReseedImages={handleReseedImages}
        onOpenTemplateModal={() => setShowTemplateModal(true)}
        onOpenCreateModal={() => setShowModal(true)}
      />

      {message && <p className="text-sm text-amber-400">{message}</p>}
      {loading && <p className="text-sm text-muted">Loading...</p>}

      <CrisesTable
        crises={crises}
        loading={loading}
        startingYear={startingYear}
        onResolve={handleResolve}
        onDelete={handleDelete}
      />

      {/* Auto Crisis system: catalog, force-trigger, live cooldowns */}
      <AutoCrisisPanel
        autoTemplates={autoTemplates}
        autoCooldowns={autoCooldowns}
        currentTurn={currentTurn}
        setMessage={setMessage}
        onRefresh={fetchCrises}
      />

      {showModal && (
        <CreateCrisisModal
          form={form}
          setForm={setForm}
          submitting={submitting}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <CreateFromTemplateModal
          selectedTemplate={selectedTemplate}
          setSelectedTemplate={setSelectedTemplate}
          templateTargetCountries={templateTargetCountries}
          setTemplateTargetCountries={setTemplateTargetCountries}
          templateRegionIds={templateRegionIds}
          setTemplateRegionIds={setTemplateRegionIds}
          templateDuration={templateDuration}
          setTemplateDuration={setTemplateDuration}
          templateSubmitting={templateSubmitting}
          onSubmit={handleTemplateSubmit}
          onClose={() => setShowTemplateModal(false)}
          onCancel={() => {
            setShowTemplateModal(false);
            setSelectedTemplate("");
            setTemplateTargetCountries([]);
            setTemplateRegionIds("");
            setTemplateDuration("");
          }}
        />
      )}
    </div>
  );
}
