"use client";

import { useCallback, useReducer, useRef } from "react";
import { usePathname } from "next/navigation";
import { FeedbackModal } from "@/components/FeedbackModal";
import { useChromeSuppressed } from "@/hooks/useChromeSuppressed";
import { isChromeHiddenPath } from "@/lib/constants/layoutPaths";
import type { DisplayMode } from "@/lib/displayMode";

interface FabState {
  feedbackOpen: boolean;
  screenshotDataUrl: string | null;
  capturingFeedback: boolean;
  screenshotCaptureFailed: boolean;
}

type FabAction =
  | { type: "OPEN_FEEDBACK"; screenshotDataUrl: string | null; screenshotCaptureFailed: boolean }
  | { type: "CLOSE_FEEDBACK" }
  | { type: "SET_CAPTURING_FEEDBACK"; capturingFeedback: boolean };

const initialFabState: FabState = {
  feedbackOpen: false,
  screenshotDataUrl: null,
  capturingFeedback: false,
  screenshotCaptureFailed: false,
};

function fabReducer(state: FabState, action: FabAction): FabState {
  switch (action.type) {
    case "OPEN_FEEDBACK":
      return {
        ...state,
        feedbackOpen: true,
        capturingFeedback: false,
        screenshotDataUrl: action.screenshotDataUrl,
        screenshotCaptureFailed: action.screenshotCaptureFailed,
      };
    case "CLOSE_FEEDBACK":
      return {
        ...state,
        feedbackOpen: false,
        screenshotDataUrl: null,
        screenshotCaptureFailed: false,
      };
    case "SET_CAPTURING_FEEDBACK":
      return {
        ...state,
        capturingFeedback: action.capturingFeedback,
        screenshotCaptureFailed: false,
      };
    default:
      return state;
  }
}

export function BugReportFab({ displayMode }: { displayMode?: DisplayMode | null }) {
  const pathname = usePathname();
  const chromeSuppressed = useChromeSuppressed(displayMode);
  const [state, dispatch] = useReducer(fabReducer, initialFabState);
  const capturingRef = useRef(false);

  const handleOpenFeedback = useCallback(async () => {
    if (capturingRef.current) return;

    capturingRef.current = true;
    dispatch({ type: "SET_CAPTURING_FEEDBACK", capturingFeedback: true });
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const { captureFeedbackScreenshot } =
        await import("@/lib/feedback/captureFeedbackScreenshot");
      const { dataUrl, captureFailed } = await captureFeedbackScreenshot();
      dispatch({
        type: "OPEN_FEEDBACK",
        screenshotDataUrl: dataUrl,
        screenshotCaptureFailed: captureFailed,
      });
    } catch {
      dispatch({
        type: "OPEN_FEEDBACK",
        screenshotDataUrl: null,
        screenshotCaptureFailed: true,
      });
    } finally {
      capturingRef.current = false;
    }
  }, []);

  const handleCloseFeedback = useCallback(() => {
    dispatch({ type: "CLOSE_FEEDBACK" });
  }, []);

  if (!chromeSuppressed || isChromeHiddenPath(pathname)) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpenFeedback()}
        disabled={state.capturingFeedback}
        aria-label="Report a bug"
        title="Report a bug"
        data-feedback-ignore="true"
        className="fixed right-4 z-[45] flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/30 bg-card/95 text-amber-400 shadow-modal backdrop-blur-md transition-colors duration-150 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 bottom-[calc(3.75rem+env(safe-area-inset-bottom))]"
      >
        {state.capturingFeedback ? (
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        )}
        <span className="sr-only">Report a bug</span>
      </button>

      <FeedbackModal
        isOpen={state.feedbackOpen}
        onClose={handleCloseFeedback}
        initialScreenshotDataUrl={state.screenshotDataUrl}
        autoCaptureFailed={state.screenshotCaptureFailed}
        initialType="bug"
      />
    </>
  );
}
