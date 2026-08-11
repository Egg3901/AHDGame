"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TUTORIAL_CHAPTERS } from "@/lib/tutorial/chapters";
import {
  chapterIdsForPlan,
  isTutorialChapterId,
  TUTORIAL_CHAPTER_IDS,
  type TutorialChapterId,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";
import { startTutorial } from "@/components/tutorial/TutorialCoach";
import { openTutorialChooser } from "@/components/tutorial/TutorialCoachMount";

/**
 * The tutorial hub: every chapter, what the player has finished, and a way to
 * run any one of them on demand.
 *
 * The coach itself lives in the root layout, so this page only has to tell it
 * what to start. That keeps one implementation of the walkthrough rather than a
 * page-local copy that would drift.
 */

interface PlanResponse {
  plan: TutorialPlan;
  chosen: boolean;
  progress: { chapterId: string; stepId: string } | null;
  completedChapters: string[];
}

export function TutorialHubClient() {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tutorial/plan", { credentials: "same-origin" });
      if (!res.ok) {
        setLoadFailed(true);
        return;
      }
      setData((await res.json()) as PlanResponse);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  // Initial load, plus a refresh on focus: the chooser writes through the same
  // endpoint, so coming back to this tab should show the new plan.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void load();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const planned = data ? new Set(chapterIdsForPlan(data.plan)) : new Set<TutorialChapterId>();
  const done = new Set(data?.completedChapters?.filter(isTutorialChapterId) ?? []);
  const resumeChapter = isTutorialChapterId(data?.progress?.chapterId)
    ? data.progress.chapterId
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tutorial</h1>
          <p className="mt-1 text-sm text-muted">
            Run any chapter whenever you want it. Nothing here costs an action or a turn.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openTutorialChooser()}
            className="rounded-lg border border-card-border bg-card/50 px-3 py-2 text-sm font-medium transition-colors hover:border-primary/60"
          >
            Change what I want to do
          </button>
          <button
            type="button"
            onClick={() => startTutorial()}
            className="rounded-lg bg-gradient-to-r from-primary to-secondary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm transition-shadow hover:shadow-glow"
          >
            {resumeChapter ? "Resume the tour" : "Run the whole tour"}
          </button>
        </div>
      </div>

      {loadFailed && (
        <p className="mt-6 rounded-lg border border-card-border bg-card/50 p-4 text-sm text-muted">
          Could not load your tutorial progress. You can still run any chapter below.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {TUTORIAL_CHAPTER_IDS.map((id) => {
          const chapter = TUTORIAL_CHAPTERS[id];
          const inPlan = planned.has(id);
          const finished = done.has(id);
          return (
            <li
              key={id}
              className="rounded-xl border border-card-border bg-card/50 p-4 shadow-card sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <span aria-hidden>{chapter.icon}</span>
                    {chapter.title}
                    {finished && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-500">
                        Done
                      </span>
                    )}
                    {!finished && inPlan && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                        In your tour
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{chapter.blurb}</p>
                  <p className="mt-1 text-xs text-muted">
                    About {chapter.estimatedMinutes} minutes
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {chapter.wikiPathSlug && (
                    <Link
                      href={`/wiki/paths/${chapter.wikiPathSlug}`}
                      className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
                    >
                      Read more
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => startTutorial(id)}
                    className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-primary/60"
                  >
                    {finished ? "Replay" : "Start"}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
