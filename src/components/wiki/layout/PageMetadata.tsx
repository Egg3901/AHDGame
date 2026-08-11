import { getCategoryById } from "@/lib/wiki/categories";
import type { WikiPageContentType, WikiPageDifficulty } from "@/lib/db/types";

interface PageMetadataProps {
  category?: string;
  contentType?: WikiPageContentType;
  difficulty?: WikiPageDifficulty;
  estimatedReadTime?: number;
  lastUpdated?: Date;
  gameIteration?: string;
  gameStartDate?: string;
}

const CONTENT_TYPE_LABELS: Record<WikiPageContentType, string> = {
  guide: "Guide",
  reference: "Reference",
  mechanics: "Mechanics",
  strategy: "Strategy",
};

const DIFFICULTY_LABELS: Record<WikiPageDifficulty, { label: string; className: string }> = {
  beginner: { label: "Beginner", className: "text-success" },
  intermediate: { label: "Intermediate", className: "text-warning" },
  advanced: { label: "Advanced", className: "text-error" },
};

function ClockIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

export function PageMetadata({
  category,
  contentType,
  difficulty,
  estimatedReadTime,
  lastUpdated,
  gameIteration,
  gameStartDate,
}: PageMetadataProps) {
  const categoryData = category ? getCategoryById(category) : undefined;

  if (
    !categoryData &&
    !contentType &&
    !difficulty &&
    !estimatedReadTime &&
    !lastUpdated &&
    !gameIteration &&
    !gameStartDate
  ) {
    return null;
  }

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-2 text-xs"
      role="contentinfo"
      aria-label="Page metadata"
    >
      {categoryData && (
        <span className="rounded-md border border-card-border bg-card/40 px-2.5 py-1 font-medium text-muted">
          {categoryData.name}
        </span>
      )}

      {contentType && (
        <span className="rounded-md border border-card-border bg-card/40 px-2.5 py-1 text-muted">
          {CONTENT_TYPE_LABELS[contentType]}
        </span>
      )}

      {difficulty && (
        <span
          className={`rounded-md border border-card-border bg-card/40 px-2.5 py-1 font-semibold uppercase tracking-[0.08em] ${DIFFICULTY_LABELS[difficulty].className}`}
        >
          {DIFFICULTY_LABELS[difficulty].label}
        </span>
      )}

      {estimatedReadTime && estimatedReadTime > 0 && (
        <span className="flex items-center gap-1.5 rounded-md border border-card-border bg-card/40 px-2.5 py-1 text-muted">
          <ClockIcon />
          {estimatedReadTime} min read
        </span>
      )}

      {lastUpdated && (
        <span className="flex items-center gap-1.5 rounded-md border border-card-border bg-card/40 px-2.5 py-1 text-muted">
          <CalendarIcon />
          Updated{" "}
          {new Date(lastUpdated).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      )}

      {gameStartDate && (
        <span className="flex items-center gap-1.5 rounded-md border border-secondary/30 bg-secondary/10 px-2.5 py-1 font-medium text-secondary">
          <svg
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {gameStartDate}
        </span>
      )}

      {gameIteration && (
        <span className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">
          <svg
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z"
            />
          </svg>
          {gameIteration}
        </span>
      )}
    </div>
  );
}
