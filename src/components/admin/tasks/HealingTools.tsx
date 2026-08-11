"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";

/**
 * Admin healing tools for fixing data issues
 * Currently supports: Bug #0803 nationalization share loss healing
 */
export function HealingTools() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<string>("");

  async function runHealing() {
    if (isRunning) return;

    setIsRunning(true);
    setResults("Starting healing process...\n");

    try {
      const response = await fetch("/api/admin/heal/nationalization-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dryRun }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResults(
        dryRun
          ? `Dry run completed — no changes were made.\n\n${data.message}`
          : `Healing completed successfully.\n\n${data.message}`
      );
    } catch (error) {
      console.error("Healing failed:", error);
      setResults(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setIsDialogOpen(true)}>
        <span className="mr-2 text-red-500">🩹</span>
        Healing Tools
      </Button>

      <Modal
        open={isDialogOpen}
        onClose={() => {
          if (!isRunning) setIsDialogOpen(false);
        }}
        title="Data Healing Tools"
        closeOnEscape={!isRunning}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">Fix known data issues from bugs. Use with caution!</p>

          <div className="space-y-2">
            <Label htmlFor="healing-type">Healing Operation</Label>
            <select
              id="healing-type"
              disabled
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="nationalization-shares">Bug #0803: Nationalization Share Loss</option>
            </select>
            <p className="text-xs text-muted">
              Fixes corporations that lost shares when nationalized
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            Dry Run (preview only, no changes)
          </label>

          {results && (
            <div className="rounded-md border border-border bg-card p-3 text-sm font-mono">
              <pre className="whitespace-pre-wrap break-all">{results}</pre>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button
              variant={dryRun ? "primary" : "destructive"}
              onClick={runHealing}
              disabled={isRunning}
            >
              {isRunning ? "Running..." : dryRun ? "Run Dry Run" : "Confirm & Heal"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
