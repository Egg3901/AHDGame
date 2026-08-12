"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TUTORIAL_CHAPTERS, buildChapterTour, buildTourSteps } from "@/lib/tutorial/chapters";
import { coachCountryContext, type CoachCharacter, type TourStep } from "@/lib/tutorial/coachSteps";
import { parseTutorialFacts, type TutorialFacts } from "@/lib/tutorial/facts";
import {
  DEFAULT_TUTORIAL_PLAN,
  isTutorialChapterId,
  type TutorialChapterId,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";

/**
 * Interactive tutorial coach — a spotlight-tooltip walkthrough over the real
 * app, modeled on the Electioneer / MetroForge onboarding coach and adapted for
 * A House Divided's multi-route shell.
 *
 * Mounted once in the root layout so it survives route navigation. Each step
 * highlights a real `data-coach="…"` element, and steps that live on another
 * page offer a button that navigates there; when the player arrives and the
 * anchor renders, the spotlight rides it.
 *
 * The tour is assembled from chapters (see chapters.ts), so the card carries a
 * chapter rail the player can read and jump around in, a back button, and live
 * world numbers for the steps that declare them. Progress is written to the
 * character so a device switch resumes mid-tour; localStorage is kept as the
 * offline fast path and as the "already finished this" memory.
 *
 * Replay: dispatch `window` event `ahd:start-tutorial`, optionally with a
 * chapter id in `detail` to replay that chapter alone.
 */

// v2: bumped with the chapter redesign. A player who finished or skipped the
// old flat tour still carries the v1 done flag, and reusing the key would hide
// the new tour from them permanently.
export const TUTORIAL_DONE_KEY = "ahd-tutorial-done-v2";
export const TUTORIAL_STEP_KEY = "ahd-tutorial-step-v2";
export const TUTORIAL_START_EVENT = "ahd:start-tutorial";

/** Fire from anywhere (the /tutorial hub) to (re)start the tour. */
export function startTutorial(chapterId?: TutorialChapterId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TUTORIAL_START_EVENT, { detail: chapterId ?? null }));
}

type Rect = { top: number; left: number; width: number; height: number };

/**
 * A measured box, tagged with the anchor it was measured from. The tag is what
 * lets the spotlight be derived rather than cleared: a rect left over from the
 * previous step is simply not for the current anchor, so it is never shown.
 */
type AnchoredRect = { anchor: string; rect: Rect };

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === null || b === null
    ? a === b
    : a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

const sameAnchored = (a: AnchoredRect | null, b: AnchoredRect | null): boolean =>
  a === null || b === null ? a === b : a.anchor === b.anchor && sameRect(a.rect, b.rect);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

const pathOf = (link: string | undefined): string | null =>
  link ? link.split("?")[0].split("#")[0] : null;

/**
 * Progress writes are best effort: localStorage already holds the resume point,
 * so a failed save must not interrupt the tour with an error state. Surface it
 * in development rather than swallowing it silently.
 */
const bestEffort =
  (what: string) =>
  (err: unknown): void => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`TutorialCoach: ${what} failed`, err);
    }
  };

export interface TutorialCoachProps {
  character: CoachCharacter;
  plan?: TutorialPlan;
  /** Start immediately, bypassing the done key (used by first-run auto-start). */
  autoStart?: boolean;
}

export function TutorialCoach({ character, plan, autoStart }: TutorialCoachProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("tutorial");

  // Copy fields on a step are message keys under "tutorial"; every t() call
  // shares one ICU value bag built from the character's country. The region
  // noun is itself translated (catalog key when known, config noun otherwise);
  // country and legislature names are proper nouns and pass through as is.
  const values = useMemo(() => {
    const ctx = coachCountryContext(character);
    const nounKey = ctx.region === "autonomous community" ? "autonomousCommunity" : ctx.region;
    return {
      countryName: ctx.countryName,
      legislatureName: ctx.legislatureName,
      region: t.has(`regionNouns.${nounKey}`) ? t(`regionNouns.${nounKey}`) : ctx.region,
    };
  }, [character, t]);

  // A single-chapter replay swaps the step list without touching the plan.
  const [replayChapter, setReplayChapter] = useState<TutorialChapterId | null>(null);

  const steps: TourStep[] = useMemo(
    () =>
      replayChapter
        ? buildChapterTour(character, replayChapter)
        : buildTourSteps(character, plan ?? DEFAULT_TUTORIAL_PLAN),
    [character, plan, replayChapter]
  );

  /** Chapter rail: one entry per chapter, with the step index it starts at. */
  const chapters = useMemo(() => {
    const out: Array<{
      id: TutorialChapterId;
      title: string;
      icon: string;
      firstStep: number;
    }> = [];
    steps.forEach((step, index) => {
      if (out.at(-1)?.id !== step.chapterId) {
        out.push({
          id: step.chapterId,
          title: step.chapterTitle,
          icon: TUTORIAL_CHAPTERS[step.chapterId]?.icon ?? "•",
          firstStep: index,
        });
      }
    });
    return out;
  }, [steps]);

  const [active, setActive] = useState(false);
  /**
   * The pathname the coach has finished settling on, or null before the first
   * settle. Arming is a property of the *route*, not of the step: once a route
   * has settled, every step change on it is armed immediately.
   */
  const [armedPath, setArmedPath] = useState<string | null>(null);
  // True once the coach has armed at least once during this activation. The
  // card render is gated on this, not on `armed`, so re-arming (a step change,
  // a route change) never unmounts the card mid-tour.
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [measured, setMeasured] = useState<AnchoredRect | null>(null);
  const [mobile, setMobile] = useState(false);
  const [facts, setFacts] = useState<TutorialFacts>({});
  const startedRef = useRef(false);
  const savedChaptersRef = useRef(new Set<string>());

  const armed = active && armedPath === pathname;

  // Begin the tour: reset progress and go live. Idempotent.
  const begin = useCallback((from = 0) => {
    startedRef.current = true;
    setStep(from);
    setActive(true);
  }, []);

  // First-run auto-start + replay event wiring.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setReplayChapter(isTutorialChapterId(detail) ? detail : null);
      begin(0);
    };
    window.addEventListener(TUTORIAL_START_EVENT, onStart);

    // Auto-start is deferred to a task so it does not setState synchronously in
    // the effect body and so the first page settles before the spotlight arms.
    let startTimer: number | undefined;
    if (!startedRef.current) {
      let done = false;
      let resume = 0;
      try {
        done = window.localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
        resume = Number(window.localStorage.getItem(TUTORIAL_STEP_KEY) ?? "0");
      } catch {
        done = false;
      }
      if (autoStart && !done) {
        const from = Number.isFinite(resume) && resume > 0 ? resume : 0;
        startTimer = window.setTimeout(() => begin(from), 0);
      }
    }
    return () => {
      window.removeEventListener(TUTORIAL_START_EVENT, onStart);
      if (startTimer) window.clearTimeout(startTimer);
    };
  }, [autoStart, begin]);

  // Server-side resume point. The stored step id wins over the localStorage
  // index, so a player who reached step 6 on their phone lands on step 6 here.
  // Consulted once per activation, and only for the real tour.
  useEffect(() => {
    if (!active || replayChapter) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tutorial/plan", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as { progress?: { stepId?: string } | null };
        const stepId = data.progress?.stepId;
        if (cancelled || !stepId) return;
        const index = steps.findIndex((s) => s.id === stepId);
        // Only ever move forward: never drag a player back to an older step.
        if (index > 0) setStep((currentStep) => (index > currentStep ? index : currentStep));
      } catch {
        /* offline: the localStorage index already covers this */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately not keyed on `step`: this is a one-shot resume, not a sync.
  }, [active, replayChapter, steps]);

  // Live world numbers, fetched once per activation and shared by every card.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tutorial/context", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFacts(parseTutorialFacts(data));
      } catch {
        /* facts are optional garnish; a card without them still reads fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Arm ~450ms after going active or navigating, so a fresh route settles and
  // its anchor mounts before we try to spotlight. Re-running on pathname is
  // what makes cross-page highlighting reliable: after "Take me there" lands on
  // the new page we disarm and re-detect against fresh DOM.
  //
  // A plain "Next" on the same page does NOT disarm. The anchors of the current
  // page are already mounted, so there is nothing to wait for, and disarming
  // used to blank the whole widget for 450ms on every Next press — the reported
  // flicker. Only a route change re-opens the settle window, and `step` is
  // deliberately not a dependency here. `finish` owns the teardown.
  useEffect(() => {
    if (!active || armedPath === pathname) return;
    const t = window.setTimeout(() => {
      setArmedPath(pathname);
      setReady(true);
    }, 450);
    return () => window.clearTimeout(t);
  }, [active, armedPath, pathname]);

  // Track viewport for mobile bottom-sheet layout.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = () => setMobile(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const current = steps[step];

  // Persist the current step, locally for speed and on the character so the
  // tour survives a device change. A replay is not real progress, so it is not
  // written back.
  useEffect(() => {
    if (!active || !current) return;
    try {
      window.localStorage.setItem(TUTORIAL_STEP_KEY, String(step));
    } catch {
      /* private mode */
    }
    if (replayChapter) return;
    void fetch("/api/tutorial/plan", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress: { chapterId: current.chapterId, stepId: current.id } }),
    }).catch(bestEffort("progress save"));
  }, [active, step, current, replayChapter]);

  // Mark a chapter finished the first time the player leaves its last step.
  useEffect(() => {
    if (!active || !current || replayChapter) return;
    const previous = steps[step - 1];
    if (!previous || previous.chapterId === current.chapterId) return;
    if (savedChaptersRef.current.has(previous.chapterId)) return;
    savedChaptersRef.current.add(previous.chapterId);
    void fetch("/api/tutorial/plan", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedChapter: previous.chapterId }),
    }).catch(bestEffort("chapter completion save"));
  }, [active, step, current, steps, replayChapter]);

  const onStepPage = !current?.link || pathOf(current.link) === pathname;

  // Follow the anchor's on-screen box while active and on the right page.
  //
  // The measurement is never cleared on teardown. Clearing it there made every
  // step change flash the plain full-screen scrim for a frame before the next
  // anchor resolved. Instead the stored box carries its anchor id and the
  // rendered spotlight is derived from it, so a stale box is simply not shown
  // and stepping between two anchored steps moves the ring instead of blinking.
  const anchor = current?.anchor;
  useEffect(() => {
    if (!active || !armed || !anchor || !onStepPage) return;
    const selector = `[data-coach="${anchor}"]`;
    const update = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      const next: AnchoredRect | null =
        r && r.width > 0
          ? { anchor, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
          : null;
      setMeasured((prev) => (sameAnchored(prev, next) ? prev : next));
    };
    update();
    const el = document.querySelector(selector);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const iv = window.setInterval(update, 200);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(iv);
    };
  }, [active, armed, anchor, onStepPage, pathname]);

  /**
   * The box to spotlight right now: only ever the current step's own anchor,
   * and only while the coach is armed and on the step's page.
   */
  const rect: Rect | null =
    active && armed && anchor && onStepPage && measured?.anchor === anchor ? measured.rect : null;

  // Advance-on-real-action: while a step declares an advanceSignal, poll the
  // live signals and move on once the player actually does it (joins a party,
  // votes, campaigns, files for a race, invests, takes a company, backs a union).
  useEffect(() => {
    const signal = current?.advanceSignal;
    if (!active || !signal) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/onboarding/signals", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, boolean>;
        if (!cancelled && data[signal] === true) setStep((s) => s + 1);
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("TutorialCoach: advance poll failed", err);
        }
      }
    };
    check();
    const iv = window.setInterval(check, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [active, current]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(TUTORIAL_DONE_KEY, "1");
      window.localStorage.removeItem(TUTORIAL_STEP_KEY);
    } catch {
      /* private mode */
    }
    // Clear the server resume point too, so a later replay starts clean.
    void fetch("/api/tutorial/plan", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress: null }),
    }).catch(bestEffort("progress clear"));
    setActive(false);
    setArmedPath(null);
    setReady(false);
    setReplayChapter(null);
    setStep(0);
  }, []);

  const advance = useCallback(() => {
    setStep((s) => {
      if (s >= steps.length - 1) {
        finish();
        return s;
      }
      return s + 1;
    });
  }, [steps.length, finish]);

  const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Gated on `ready`, not `armed`: the card must survive re-arming. Before the
  // first arm there is nothing to show; after it, the card stays mounted for
  // the rest of the tour and only the spotlight comes and goes.
  if (!active || !ready || !current) return null;

  // Card placement: below the spotlight when it fits, else above; clamped to viewport.
  const CARD_W = 360;
  const CARD_H = 260;
  const GAP = 14;
  const PAD = 12;
  let cardStyle: CSSProperties = {};
  let placement: "anchored" | "centered" = "centered";
  if (!mobile && rect) {
    placement = "anchored";
    const below = rect.top + rect.height + GAP + CARD_H <= window.innerHeight;
    const rawTop = below ? rect.top + rect.height + GAP : rect.top - GAP - CARD_H;
    cardStyle = {
      top: clamp(rawTop, PAD, window.innerHeight - CARD_H - PAD),
      left: clamp(rect.left + rect.width / 2 - CARD_W / 2, PAD, window.innerWidth - CARD_W - PAD),
      width: CARD_W,
    };
  }

  const needsNav = Boolean(current.link) && !current.external && !onStepPage;
  const chapterNumber = chapters.findIndex((c) => c.id === current.chapterId) + 1;
  const visibleFacts = (current.facts ?? [])
    .map((key) => facts[key])
    .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));

  return (
    <div className="fixed inset-0 z-[190] pointer-events-none" role="dialog" aria-label={t("coach.dialogLabel")}>
      {rect ? (
        <>
          {/* Cut-out scrim plus a bright ring on the highlighted element. */}
          <div
            className="fixed rounded-lg pointer-events-none transition-all duration-200"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow:
                "0 0 0 9999px rgba(0,0,0,0.68), 0 0 0 2px rgba(96,165,250,1), 0 0 22px 4px rgba(96,165,250,0.55)",
            }}
          />
          {/* Slow halo so the eye lands on the target without the ring jittering. */}
          <div
            className="fixed rounded-lg pointer-events-none animate-ping"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow: "0 0 0 3px rgba(96,165,250,0.85)",
              animationDuration: "2.2s",
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/68 pointer-events-none" />
      )}

      {/* Design tokens, not hardcoded neutrals. The card used to be a white
          panel with blue buttons dropped into an otherwise dark app, because it
          only went dark under a `dark:` class this app does not set. */}
      <div
        className={
          "pointer-events-auto rounded-xl border border-card-border bg-card text-foreground shadow-xl p-4 " +
          (mobile
            ? "fixed left-3 right-3 bottom-3"
            : placement === "anchored"
              ? "fixed"
              : // Unanchored steps sit low rather than dead centre: a centred
                // card covers the very content the step is telling you to read.
                "fixed bottom-6 left-1/2 -translate-x-1/2 w-[360px]")
        }
        style={placement === "anchored" && !mobile ? cardStyle : undefined}
      >
        {/* Chapter rail. Each chapter is its own labelled, clickable stop, so
            the player can see where they are, what is left, and jump. */}
        {chapters.length > 1 && (
          <nav className="flex items-center gap-1" aria-label={t("coach.chapterRail")}>
            {chapters.map((chapter, index) => {
              const here = index === chapterNumber - 1;
              const done = index < chapterNumber - 1;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  title={t(chapter.title)}
                  aria-label={t("coach.goToChapter", { title: t(chapter.title) })}
                  aria-current={here ? "step" : undefined}
                  onClick={() => setStep(chapter.firstStep)}
                  className={`flex min-w-0 items-center gap-1 rounded-full px-1.5 py-1 text-[11px] leading-none transition-colors ${
                    here
                      ? "flex-1 bg-primary/15 font-semibold text-primary"
                      : done
                        ? "text-primary/70 hover:bg-primary/10"
                        : "text-muted hover:bg-muted/10"
                  }`}
                >
                  <span aria-hidden className={here ? "" : "opacity-60"}>
                    {chapter.icon}
                  </span>
                  {here && <span className="truncate">{t(chapter.title)}</span>}
                </button>
              );
            })}
          </nav>
        )}

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {chapters.length > 1
              ? t("coach.chapterProgress", { number: chapterNumber, total: chapters.length })
              : t(current.chapterTitle)}
          </span>
          <span className="text-[11px] tabular-nums text-muted">
            {t("coach.stepProgress", { step: step + 1, total: steps.length })}
          </span>
        </div>

        <h4 className="mt-1 text-base font-semibold leading-snug">{t(current.title, values)}</h4>
        <p className="mt-1 text-sm leading-relaxed text-muted">{t(current.body, values)}</p>

        {visibleFacts.length > 0 && (
          <dl className="mt-2 space-y-0.5 rounded-lg bg-card-muted px-2.5 py-2">
            {visibleFacts.map((fact) => (
              <div key={fact.label} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="shrink-0 text-muted">{fact.label}</dt>
                <dd className="text-right font-medium tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {current.hint && (
          <p className="mt-2 text-xs font-medium text-primary">{t(current.hint, values)}</p>
        )}

        {current.readMore && (
          <Link
            href={current.readMore.href}
            className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {t(current.readMore.label)} →
          </Link>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={finish}
              className="text-xs text-muted hover:text-foreground"
            >
              {t("coach.skip")}
            </button>
            {step > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="text-xs text-muted hover:text-foreground"
              >
                {t("coach.back")}
              </button>
            )}
          </div>
          {/* The primary slot always advances the tour. An external step used to
              put "open a new tab" in that same slot, so clicking through at
              speed threw the player out of the app and into Discord. The
              external link now sits beside it as a secondary action, marked as
              leaving the page. */}
          <div className="flex items-center gap-2">
            {current.external && current.link && (
              <button
                type="button"
                onClick={() => window.open(current.link, "_blank", "noopener,noreferrer")}
                className="rounded-md border border-card-border px-3 py-1.5 text-sm font-medium text-foreground hover:border-primary/50 hover:text-primary"
              >
                {t(current.next)} <span aria-hidden>↗</span>
              </button>
            )}
            {needsNav && !current.external ? (
              <button
                type="button"
                onClick={() => current.link && router.push(current.link)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {t("coach.takeMeThere")}
              </button>
            ) : (
              <button
                type="button"
                onClick={advance}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {current.external ? t("coach.next") : t(current.next)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
