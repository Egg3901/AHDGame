"use client";

import { useCallback, useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEFAULT_TUTORIAL_PLAN,
  resolveTutorialPlan,
  type TutorialPlan,
} from "@/lib/onboarding/tutorialPlan";
import { TutorialCoach } from "./TutorialCoach";
import { TutorialWelcome } from "./TutorialWelcome";

/**
 * Mounts the tutorial surfaces for the signed-in character.
 *
 * Two things live here because they share one fetch and one piece of state:
 *  - the welcome flow, shown to a freshly created character who has not chosen
 *    a plan yet (or to anyone who asks for it from /tutorial), and
 *  - the spotlight coach, which runs the plan.
 *
 * Renders nothing for logged-out users and accounts without a character. The
 * coach auto-starts only for a character created inside the fresh window, so
 * existing players are never surprised by the tour; they can replay it from the
 * tutorial page. The coach's own localStorage done key still guarantees it
 * shows once.
 */

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fire from anywhere (the /tutorial hub) to re-open the two-question flow. */
export const TUTORIAL_CHOOSE_EVENT = "ahd:choose-tutorial";

export function openTutorialChooser(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TUTORIAL_CHOOSE_EVENT));
}

interface CoachMountState {
  countryId: string;
  homeState: string;
  name?: string | null;
  plan: TutorialPlan;
  /** False until the player answers the welcome flow. */
  chosen: boolean;
  fresh: boolean;
}

export function TutorialCoachMount() {
  const [state, setState] = useState<CoachMountState | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [dismissedChooser, setDismissedChooser] = useState(false);
  /** True once the player answers in this session, so the tour starts straight away. */
  const [justChose, setJustChose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/character/me", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        const c = data?.character as
          | {
              name?: string | null;
              countryId?: string;
              homeState?: string;
              tutorial?: { experience?: unknown; interests?: unknown; chosenAt?: string } | null;
              tutorialTrack?: string | null;
              createdAt?: string | null;
            }
          | undefined;
        if (cancelled || !c?.countryId || !c.homeState) return;
        const createdMs = c.createdAt ? new Date(c.createdAt).getTime() : NaN;
        setState({
          countryId: c.countryId,
          homeState: c.homeState,
          name: c.name,
          plan: resolveTutorialPlan(c),
          chosen: Boolean(c.tutorial?.chosenAt),
          fresh: Number.isFinite(createdMs) && Date.now() - createdMs < FRESH_WINDOW_MS,
        });
      } catch (err) {
        // Not signed in / offline: leave both surfaces hidden.
        if (process.env.NODE_ENV !== "production") {
          console.debug("TutorialCoachMount: /api/character/me unavailable", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChoose = () => {
      setDismissedChooser(false);
      setChoosing(true);
    };
    window.addEventListener(TUTORIAL_CHOOSE_EVENT, onChoose);
    return () => window.removeEventListener(TUTORIAL_CHOOSE_EVENT, onChoose);
  }, []);

  const savePlan = useCallback(async (plan: TutorialPlan) => {
    const res = await fetch("/api/tutorial/plan", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experience: plan.experience, interests: plan.interests }),
    });
    if (!res.ok) throw new Error("Failed to save tutorial plan");
    setState((prev) => (prev ? { ...prev, plan, chosen: true } : prev));
    setJustChose(true);
    setChoosing(false);
  }, []);

  if (!state) return null;

  // Ask anyone who has not answered yet, not only brand new characters.
  //
  // This gate used to require `state.fresh` (character under 24h old). That
  // meant every existing player fell straight through to the default
  // all-interests plan and got a tour that looked exactly like the old one,
  // with no way to discover that the choice existed. Being asked once is
  // cheap, "Decide later" dismisses it for the session, and the answer is
  // stored, so nobody is asked twice.
  const askNow = choosing || (!state.chosen && !dismissedChooser);

  if (askNow) {
    return (
      <TutorialWelcome
        characterName={state.name}
        onConfirm={savePlan}
        onDismiss={() => {
          setChoosing(false);
          setDismissedChooser(true);
        }}
      />
    );
  }

  return (
    <TutorialCoach
      character={{ countryId: state.countryId as CountryId, homeState: state.homeState }}
      plan={state.chosen ? state.plan : DEFAULT_TUTORIAL_PLAN}
      // Auto-start only for someone who just picked a tour, or a brand new
      // character resuming one. An existing player who dismissed the chooser is
      // left alone; they can start it from /tutorial.
      autoStart={state.chosen && state.plan.experience !== "skip" && (state.fresh || justChose)}
    />
  );
}
