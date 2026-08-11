"use client";

interface ScreenshotUploaderProps {
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
}

export function ScreenshotUploader({
  screenshotDataUrl,
  includeScreenshot,
  onIncludeChange,
  onUpload,
  onRemove,
  onFileChange,
  fileInputRef,
  uploading,
  error,
  initialScreenshotDataUrl,
  autoCaptureFailed,
}: ScreenshotUploaderProps) {
  return (
    <div className="rounded-lg border border-card-border bg-background/50">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-muted">
          Screenshot <span className="text-xs font-normal text-muted/60">(optional)</span>
        </span>
        <div className="flex items-center gap-2">
          {screenshotDataUrl && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => onIncludeChange(e.target.checked)}
                className="rounded border-card-border"
              />
              <span className="text-xs text-muted">Include</span>
            </label>
          )}
          <button
            type="button"
            onClick={onUpload}
            className="rounded-md border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            {screenshotDataUrl ? "Replace" : "Upload"}
          </button>
          {screenshotDataUrl && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFileChange}
      />
      {screenshotDataUrl && includeScreenshot ? (
        <div className="border-t border-card-border px-4 pb-3">
          {initialScreenshotDataUrl && screenshotDataUrl === initialScreenshotDataUrl && (
            <p className="mt-2 text-xs text-muted/70">Auto-captured before modal opened</p>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL not supported by next/image */}
          <img
            src={screenshotDataUrl}
            alt="Screenshot preview"
            className="mt-1 w-full rounded border border-card-border object-contain max-h-40"
          />
          {uploading && <p className="mt-1 text-xs text-muted">Uploading screenshot…</p>}
          {error && (
            <p className="mt-1 text-xs text-red-400">
              {error} — report will be submitted without it.
            </p>
          )}
        </div>
      ) : !screenshotDataUrl ? (
        <div className="border-t border-card-border px-4 py-3 text-xs text-muted">
          {autoCaptureFailed
            ? "Auto-capture failed — upload a screenshot manually if helpful."
            : "No screenshot attached — click Upload to add one."}
        </div>
      ) : null}
    </div>
  );
}
