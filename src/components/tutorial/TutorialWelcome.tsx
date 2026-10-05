"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { INTEREST_CHAPTERS, estimateTourMinutes } from "@/lib/tutorial/chapters";
import { whatsNewEditionForPreset, type WhatsNewEdition } from "@/lib/tutorial/world";
import { useWorldFlags } from "@/hooks/useWorldFlags";
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

/**
 * Message keys under "tutorial" for each experience card. The returning blurb
 * names the world the player is coming from, so it is chosen per edition.
 */
const experiences = (
  edition: WhatsNewEdition
): Array<{
  value: TutorialExperience;
  title: string;
  blurb: string;
}> => [
  {
    value: "new",
    title: "welcome.experienceNewTitle",
    blurb: "welcome.experienceNewBlurb",
  },
  {
    value: "returning",
    title: "welcome.experienceReturningTitle",
    blurb:
      edition === "1991"
        ? "welcome.experienceReturning1991Blurb"
        : "welcome.experienceReturningBlurb",
  },
  {
    value: "skip",
    title: "welcome.experienceSkipTitle",
    blurb: "welcome.experienceSkipBlurb",
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
  const t = useTranslations("tutorial");
  const { preset } = useWorldFlags();
  const edition = whatsNewEditionForPreset(preset);
  const [experience, setExperience] = useState<TutorialExperience | null>(null);
  const [interests, setInterests] = useState<TutorialInterest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panel = experience === null || experience === "skip" ? 1 : 2;
  const allSelected = interests.length === TUTORIAL_INTERESTS.length;

  // Read off the same chapter list the tour runs, so the "what changed" and
  // core chapters are counted rather than guessed at.
  const estimate = useMemo(
    () => estimateTourMinutes({ experience: experience ?? "new", interests }),
    [experience, interests]
  );

  /**
   * What "All of it" actually costs. The per-topic minutes were shown on each
   * card but never added up, so the card badged "Most players" quietly asked
   * for the sum of all of them without ever naming it.
   */
  const fullEstimate = useMemo(
    () =>
      estimateTourMinutes({ experience: experience ?? "new", interests: [...TUTORIAL_INTERESTS] }),
    [experience]
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
      setError(t("welcome.saveFailed"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-card-border bg-card/70 shadow-card">
          <div className="rounded-t-2xl px-6 pt-6 pb-2 sm:px-8">
            <p className="text-xs font-semibold text-muted">
              {t("welcome.stepProgress", { panel })}
            </p>
            <h1 className="mt-1 text-2xl font-bold">
              {panel === 1
                ? characterName
                  ? t("welcome.titleNamed", { name: characterName })
                  : t("welcome.title")
                : t("welcome.interestsTitle")}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {panel === 1 ? t("welcome.intro") : t("welcome.interestsIntro")}
            </p>
          </div>

          {panel === 1 ? (
            <div className="grid gap-3 p-6 sm:grid-cols-3 sm:p-8 sm:pt-4">
              {experiences(edition).map((opt) => (
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
                  <span className="block text-sm font-semibold">{t(opt.title)}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">
                    {t(opt.blurb)}
                  </span>
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
                  {t("welcome.allOfIt")}
                  <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] font-medium text-muted">
                    {t("welcome.mostPlayers")}
                  </span>
                  <span className="ml-auto text-body-sm font-medium text-muted">
                    {t("welcome.aboutMinutesShort", { minutes: fullEstimate })}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted">{t("welcome.allOfItBlurb")}</span>
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
                        <span className="text-sm font-semibold">{t(chapter.title)}</span>
                        <span className="shrink-0 text-body-sm font-medium text-muted">
                          {t("welcome.minutesShort", { minutes: chapter.estimatedMinutes })}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">
                        {t(chapter.blurb)}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  {interests.length === 0
                    ? t("welcome.pickAtLeastOne")
                    : t("welcome.estimate", { minutes: estimate })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExperience(null)}
                    disabled={saving}
                    className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {t("welcome.back")}
                  </button>
                  <Button
                    disabled={saving || interests.length === 0 || experience === null}
                    onClick={() =>
                      experience && void confirm({ experience, interests: [...interests] })
                    }
                  >
                    {saving ? t("welcome.starting") : t("welcome.start")}
                  </Button>
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
              {t("welcome.decideLater")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
