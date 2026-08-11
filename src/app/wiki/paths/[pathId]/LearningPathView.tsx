// src/app/wiki/paths/[pathId]/LearningPathView.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LearningPath } from "@/lib/wiki/learningPaths";

interface PathProgress {
  pathId: string;
  completedPages: string[];
  lastVisited: Date;
}

const DIFFICULTY_LABELS = {
  beginner: { label: "Beginner", className: "text-success" },
  intermediate: { label: "Intermediate", className: "text-warning" },
  advanced: { label: "Advanced", className: "text-error" },
} as const;

interface LearningPathViewProps {
  path: LearningPath;
  pathId: string;
}

export default function LearningPathView({ path, pathId }: LearningPathViewProps) {
  const [progress, setProgress] = useState<PathProgress | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(`path-progress-${pathId}`);
    if (stored) {
      try {
        const parsed: PathProgress = JSON.parse(stored);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProgress(parsed);
      } catch {
        localStorage.removeItem(`path-progress-${pathId}`);
      }
    }
  }, [pathId]);

  const completedCount = progress?.completedPages.length || 0;
  const totalPages = path.pages.length;
  const progressPercentage = totalPages > 0 ? (completedCount / totalPages) * 100 : 0;
  const diff = DIFFICULTY_LABELS[path.difficulty as keyof typeof DIFFICULTY_LABELS];

  return (
    <div className="mx-auto max-w-4xl min-w-0 overflow-x-hidden px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground transition-colors">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <Link href="/wiki#learning-paths" className="hover:text-foreground transition-colors">
          Learning Paths
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{path.title}</span>
      </nav>

      <div className="mb-8">
        <div className="flex items-center justify-between gap-4 mb-3">
          <p className="section-label">Learning Path</p>
          {diff && (
            <span
              className={`font-mono text-xs font-semibold uppercase tracking-[0.08em] ${diff.className}`}
            >
              {diff.label}
            </span>
          )}
        </div>
        <h1 className="mb-2 font-serif text-3xl font-bold text-foreground">{path.title}</h1>
        <p className="mb-4 text-lg text-muted">{path.description}</p>
        <div className="flex items-center gap-4 font-mono text-sm text-muted">
          <span>{totalPages} pages</span>
          <span>·</span>
          <span>{path.estimatedTime}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-8 rounded-xl border border-card-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Your progress</span>
          <span className="font-mono text-muted">
            {completedCount} / {totalPages} pages
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        {progressPercentage > 0 && (
          <p className="mt-2 font-mono text-xs text-muted">
            {Math.round(progressPercentage)}% complete
          </p>
        )}
      </div>

      {/* Page List */}
      {totalPages === 0 ? (
        <div className="rounded-xl border border-card-border bg-card/40 p-8 text-center">
          <p className="text-sm text-muted">
            No pages are available in this learning path for your current country access level.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {path.pages.map((page, index) => {
            const isCompleted = progress?.completedPages.includes(page.slug);
            return (
              <Link
                key={page.slug}
                href={`/wiki/${page.slug}?path=${pathId}`}
                className="group flex items-start gap-4 rounded-xl border border-card-border bg-card/40 p-4 transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-card/60 hover:shadow-md"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${
                    isCompleted ? "bg-primary text-white" : "bg-card-elevated text-muted"
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <div className="flex-grow min-w-0">
                  <h3 className="font-medium text-foreground transition-colors group-hover:text-primary">
                    {page.title}
                  </h3>
                  <p className="text-sm text-muted">{page.description}</p>
                  <p className="mt-1 font-mono text-xs text-muted">{page.estimatedMinutes} min</p>
                </div>
                <span
                  className="shrink-0 self-center text-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  →
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
