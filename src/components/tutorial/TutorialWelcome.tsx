"use client";

import { useEffect, useMemo, useState } from "react";
import { INTEREST_CHAPTERS } from "@/lib/tutorial/chapters";
import {
  TUTORIAL_INTERESTS,
  type TutorialExperience,
  type TutorialInterest,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";

/**
 * The welcome flow: the two questions that shape everything the tutorial does.
 *
 * Panel 1 asks how well the player knows the game, panel 2 asks what they came
 * here to do. Interests are multi-select, with an "All of it" card that toggles
 * every one, because most new players want the full game and the ones who do
 * not usually want two things rather than one.
 *
 * Full screen on purpose. This used to be a two-button row at the bottom of an
 * already long character-creation form, where nobody read it.
 */

const EXPERIENCES: Array<{
  value: TutorialExperience;
  icon: string;
  title: string;
  blurb: string;
}> = [
  {
    value: "new",
    icon: "🌱",
    title: "New to A House Divided",
    blurb: "Start from the beginning. What a turn is, how power works, and what to do first.",
  },
  {
    value: "returning",
    icon: "🔁",
    title: "New to this iteration",
    blurb: "You have played before. Skip the basics and see what changed this time around.",
  },
  {
    value: "skip",
    icon: "⏭️",
    title: "Skip the tutorial",
    blurb: "Go straight in. You can start any part of it later from the tutorial page.",
  },
];

export interface TutorialWelcomeProps {
  /** Shown on the first panel so the flow reads as personal. */
  characterName?: string | null;
  /** Persist the plan. Resolve once it is saved; the flow closes after. */
  onConfirm: (plan: TutorialPlan) => Promise<void> | void;
  /** Close without saving. The flow reappears on the next load. */
  onDismiss: () => void;
}

export function TutorialWelcome({ characterName, onConfirm, onDismiss }: TutorialWelcomeProps) {
  const [experience, setExperience] = useState<TutorialExperience | null>(null);
  const [interests, setInterests] = useState<TutorialInterest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panel = experience === null || experience === "skip" ? 1 : 2;
  const allSelected = interests.length === TUTORIAL_INTERESTS.length;

  const estimate = useMemo(
    () =>
      INTEREST_CHAPTERS.filter((c) => interests.includes(c.id as TutorialInterest)).reduce(
        // 4 minutes for the always-on core chapter.
        (total, c) => total + c.estimatedMinutes,
        4
      ),
    [interests]
  );

  /**
   * What "All of it" actually costs. The per-topic minutes were shown on each
   * card but never added up, so the card badged "Most players" quietly asked
   * for the sum of all of them without ever naming it.
   */
  const fullEstimate = useMemo(
    () => INTEREST_CHAPTERS.reduce((total, c) => total + c.estimatedMinutes, 4),
    []
  );

  // Escape closes without saving, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  function toggle(id: TutorialInterest) {
    setInterests((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  async function confirm(plan: TutorialPlan) {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(plan);
    } catch {
      setError("Could not save that. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-card-border bg-card/70 shadow-card">
          <div className="relative rounded-t-2xl px-6 pt-6 pb-2 sm:px-8">
            <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl bg-gradient-to-r from-primary/60 via-secondary/40 to-transparent" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Step {panel} of 2
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              {panel === 1
                ? characterName
                  ? `Welcome, ${characterName}`
                  : "Welcome to A House Divided"
                : "What do you want to do?"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {panel === 1
                ? "Two quick questions and the game will point you at the right things. This takes about fifteen seconds."
                : "Pick as many as you like. The tour covers each one in turn, and you can change your mind later."}
            </p>
          </div>

          {panel === 1 ? (
            <div className="grid gap-3 p-6 sm:grid-cols-3 sm:p-8 sm:pt-4">
              {EXPERIENCES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setExperience(opt.value);
                    if (opt.value === "skip") void confirm({ experience: "skip", interests: [] });
                  }}
                  className="rounded-xl border border-card-border bg-card/40 p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
                >
                  <span className="text-2xl" aria-hidden>
                    {opt.icon}
                  </span>
                  <span className="mt-2 block text-sm font-semibold">{opt.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{opt.blurb}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 sm:p-8 sm:pt-4">
              <button
                type="button"
                aria-pressed={allSelected}
                onClick={() => setInterests(allSelected ? [] : [...TUTORIAL_INTERESTS])}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  allSelected
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-card-border bg-card/40 hover:border-primary/60"
                }`}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span aria-hidden>⭐</span> All of it
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    Most players
                  </span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted">
                    about {fullEstimate} min
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted">
                  The whole game. Politics and money feed each other, and the players who do both
                  end up ahead of the ones who pick a side.
                </span>
              </button>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {INTEREST_CHAPTERS.map((chapter) => {
                  const id = chapter.id as TutorialInterest;
                  const selected = interests.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(id)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-card-border bg-card/40 hover:border-primary/60"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">
                          <span className="mr-1.5" aria-hidden>
                            {chapter.icon}
                          </span>
                          {chapter.title}
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">
                          {chapter.estimatedMinutes} min
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">
                        {chapter.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  {interests.length === 0
                    ? "Pick at least one to continue."
                    : `About ${estimate} minutes, and you can stop any time.`}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExperience(null)}
                    disabled={saving}
                    className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={saving || interests.length === 0 || experience === null}
                    onClick={() =>
                      experience && void confirm({ experience, interests: [...interests] })
                    }
                    className="rounded-lg bg-gradient-to-r from-primary to-secondary px-5 py-2 text-sm font-semibold text-white shadow-glow-sm transition-shadow hover:shadow-glow disabled:opacity-50 disabled:shadow-none"
                  >
                    {saving ? "Starting…" : "Start the tour"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="px-6 pb-4 text-xs font-medium text-red-500 sm:px-8" role="alert">
              {error}
            </p>
          )}

          <div className="border-t border-card-border/60 px-6 py-3 text-center sm:px-8">
            <button
              type="button"
              onClick={onDismiss}
              disabled={saving}
              className="text-xs text-muted transition-colors hover:text-foreground disabled:opacity-60"
            >
              Decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
