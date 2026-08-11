"use client";

import { useState } from "react";
import type { Task, TaskType, TaskPriority } from "@/lib/db/types";

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

interface TaskFormToastProps {
  onCreated: (task: Task) => void;
  onClose: () => void;
}

export function TaskFormToast({ onCreated, onClose }: TaskFormToastProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("bug");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [tagsInput, setTagsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, type, priority, tags: parseTags(tagsInput) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create task");
      onCreated(data.task as Task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Toast panel */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
        <div className="mx-auto max-w-2xl rounded-t-xl border border-card-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-card-border px-5 py-3">
            <h2 className="text-sm font-semibold">New Task</h2>
            <button
              onClick={onClose}
              className="text-muted hover:text-foreground transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Title */}
            <div>
              <input
                type="text"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                autoFocus
                className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={3}
                className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            {/* Type + Priority row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TaskType)}
                  className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="bug">Bug</option>
                  <option value="feature">Feature</option>
                  <option value="improvement">Improvement</option>
                </select>
              </div>
              <div className="flex-1">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>

            {/* Tags */}
            <div>
              <input
                type="text"
                placeholder="Tags (comma-separated, e.g. uk, elections)"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded text-sm border border-card-border hover:bg-card-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {submitting ? "Saving…" : "Save Task"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
