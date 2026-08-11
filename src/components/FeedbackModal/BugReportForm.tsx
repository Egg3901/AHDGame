"use client";

import { Input, Label, Button } from "@/components/ui";
import type { BugCategory } from "@/lib/db/types";
import { inputBase, BUG_CATEGORY_LABELS } from "./constants";
import { ScreenshotUploader } from "./ScreenshotUploader";

interface CapturedContext {
  pathname: string;
  url: string;
  capturedAt: string;
  lastAction?: { label: string; timestamp: string };
  recentActions: { label: string }[];
  viewport: { width: number; height: number };
}

interface BugReportFormProps {
  category: string;
  onCategoryChange: (c: string) => void;
  title: string;
  onTitleChange: (t: string) => void;
  description: string;
  onDescriptionChange: (d: string) => void;
  stepsToReproduce: string;
  onStepsChange: (s: string) => void;
  severity: number | "";
  onSeverityChange: (s: number | "") => void;
  showContext: boolean;
  onShowContextToggle: () => void;
  ctx: CapturedContext;
  error: string | null;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  screenshotProps: {
    screenshotDataUrl: string | null;
    includeScreenshot: boolean;
    onIncludeChange: (include: boolean) => void;
    onUpload: () => void;
    onRemove: () => void;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    uploading: boolean;
    error: string | null;
    initialScreenshotDataUrl?: string | null;
    autoCaptureFailed?: boolean;
  };
}

export function BugReportForm({
  category,
  onCategoryChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  stepsToReproduce,
  onStepsChange,
  severity,
  onSeverityChange,
  showContext,
  onShowContextToggle,
  ctx,
  error,
  submitting,
  onSubmit,
  onCancel,
  screenshotProps,
}: BugReportFormProps) {
  const categories = Object.entries(BUG_CATEGORY_LABELS) as [BugCategory, string][];

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="bug-category" className="text-muted" required>
          Category
        </Label>
        <select
          id="bug-category"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={inputBase}
          required
        >
          <option value="">Select a category...</option>
          {categories.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="bug-title-input" className="text-muted" required>
          What went wrong?
        </Label>
        <Input
          id="bug-title-input"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Brief summary of the bug"
          maxLength={200}
          className="bg-background py-2.5 text-sm"
          required
        />
      </div>

      <div>
        <Label htmlFor="bug-description" className="text-muted" required>
          Details
        </Label>
        <textarea
          id="bug-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe what happened and what you expected..."
          rows={4}
          maxLength={5000}
          className={`${inputBase} resize-none`}
          required
        />
      </div>

      <div>
        <Label htmlFor="bug-steps" className="text-muted">
          Steps to reproduce <span className="text-muted/70">(optional)</span>
        </Label>
        <textarea
          id="bug-steps"
          value={stepsToReproduce}
          onChange={(e) => onStepsChange(e.target.value)}
          placeholder="1. Go to... 2. Click... 3. See error"
          rows={3}
          maxLength={2000}
          className={`${inputBase} resize-none`}
        />
      </div>

      <div>
        <Label htmlFor="bug-severity" className="text-muted">
          Severity <span className="text-muted/70">(optional)</span>
        </Label>
        <select
          id="bug-severity"
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputBase}
        >
          <option value="">Select severity...</option>
          <option value="1">1 — Minor (cosmetic)</option>
          <option value="2">2 — Low (workaround exists)</option>
          <option value="3">3 — Medium (affects usability)</option>
          <option value="4">4 — High (blocks key feature)</option>
          <option value="5">5 — Critical (game unplayable)</option>
        </select>
      </div>

      <ScreenshotUploader {...screenshotProps} />

      <div className="rounded-lg border border-card-border bg-background/50">
        <button
          type="button"
          onClick={onShowContextToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
        >
          <span className="font-medium text-muted">Captured context (page, actions, device)</span>
          <svg
            className={`h-4 w-4 text-muted transition-transform ${showContext ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showContext && (
          <div className="border-t border-card-border px-4 py-3 text-xs text-muted space-y-2">
            <p>
              <span className="font-medium text-foreground/80">Page:</span> {ctx.pathname || "/"}
            </p>
            <p>
              <span className="font-medium text-foreground/80">URL:</span> {ctx.url}
            </p>
            <p>
              <span className="font-medium text-foreground/80">Captured:</span> {ctx.capturedAt}
            </p>
            <p>
              <span className="font-medium text-foreground/80">Viewport:</span> {ctx.viewport.width}{" "}
              × {ctx.viewport.height}
            </p>
            {ctx.lastAction && (
              <p>
                <span className="font-medium text-foreground/80">Last action:</span>{" "}
                {ctx.lastAction.label} at {ctx.lastAction.timestamp}
              </p>
            )}
            {ctx.recentActions.length > 0 && (
              <div>
                <span className="font-medium text-foreground/80">Recent actions:</span>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {ctx.recentActions.map((a, i) => (
                    <li key={i}>{a.label}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="flex-1 h-10 py-2.5 text-sm"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={submitting}
          disabled={!category || !title.trim() || !description.trim()}
          className="flex-1 h-10 py-2.5 text-sm"
        >
          Submit
        </Button>
      </div>
    </form>
  );
}
