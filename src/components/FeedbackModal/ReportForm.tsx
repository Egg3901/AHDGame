"use client";

import { Input, Label, Button } from "@/components/ui";
import type { SuggestionCategory, SuggestionGameSystem } from "@/lib/db/types";
import { inputBase, SUGGESTION_CATEGORY_LABELS, SUGGESTION_GAME_SYSTEM_LABELS } from "./constants";
import { ScreenshotUploader } from "./ScreenshotUploader";

interface CapturedContext {
  pathname: string;
  url: string;
  capturedAt: string;
  lastAction?: { label: string; timestamp: string };
  recentActions: { label: string }[];
  viewport: { width: number; height: number };
}

interface ReportFormProps {
  category: string;
  onCategoryChange: (c: string) => void;
  gameSystem: string;
  onGameSystemChange: (g: string) => void;
  title: string;
  onTitleChange: (t: string) => void;
  description: string;
  onDescriptionChange: (d: string) => void;
  impact: string;
  onImpactChange: (i: string) => void;
  priority: number | "";
  onPriorityChange: (p: number | "") => void;
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

export function ReportForm({
  category,
  onCategoryChange,
  gameSystem,
  onGameSystemChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  impact,
  onImpactChange,
  priority,
  onPriorityChange,
  showContext,
  onShowContextToggle,
  ctx,
  error,
  submitting,
  onSubmit,
  onCancel,
  screenshotProps,
}: ReportFormProps) {
  const categories = Object.entries(SUGGESTION_CATEGORY_LABELS) as [SuggestionCategory, string][];
  const systems = Object.entries(SUGGESTION_GAME_SYSTEM_LABELS) as [SuggestionGameSystem, string][];

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="suggestion-category" className="text-muted" required>
          Category
        </Label>
        <select
          id="suggestion-category"
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
        <Label htmlFor="suggestion-game-system" className="text-muted" required>
          Game area
        </Label>
        <select
          id="suggestion-game-system"
          value={gameSystem}
          onChange={(e) => onGameSystemChange(e.target.value)}
          className={inputBase}
          required
        >
          <option value="">Where does this mainly apply?</option>
          {systems.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="suggestion-title-input" className="text-muted" required>
          What would you like to see?
        </Label>
        <Input
          id="suggestion-title-input"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Brief summary of your idea"
          maxLength={200}
          className="bg-background py-2.5 text-sm"
          required
        />
      </div>

      <div>
        <Label htmlFor="suggestion-description" className="text-muted" required>
          Details
        </Label>
        <textarea
          id="suggestion-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe your idea in more detail..."
          rows={4}
          maxLength={5000}
          className={`${inputBase} resize-none`}
          required
        />
      </div>

      <div>
        <Label htmlFor="suggestion-impact" className="text-muted">
          Impact / benefit <span className="text-muted/70">(optional)</span>
        </Label>
        <textarea
          id="suggestion-impact"
          value={impact}
          onChange={(e) => onImpactChange(e.target.value)}
          placeholder="How would this improve the game?"
          rows={2}
          maxLength={500}
          className={`${inputBase} resize-none`}
        />
      </div>
      <div>
        <Label htmlFor="suggestion-priority" className="text-muted">
          Priority <span className="text-muted/70">(optional)</span>
        </Label>
        <select
          id="suggestion-priority"
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputBase}
        >
          <option value="">Select priority...</option>
          <option value="1">1 — Nice to have</option>
          <option value="2">2 — Would improve experience</option>
          <option value="3">3 — Important</option>
          <option value="4">4 — Very important</option>
          <option value="5">5 — Essential</option>
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
          disabled={!category || !gameSystem || !title.trim() || !description.trim()}
          className="flex-1 h-10 py-2.5 text-sm"
        >
          Submit
        </Button>
      </div>
    </form>
  );
}
