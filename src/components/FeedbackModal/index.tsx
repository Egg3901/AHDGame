"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import { useFeedback } from "@/contexts/FeedbackContext";
import { ReportForm } from "./ReportForm";
import { BugReportForm } from "./BugReportForm";
import { FeedbackSuccess } from "./FeedbackSuccess";
import { useScreenshotUpload } from "./useScreenshotUpload";

export type FeedbackModalType = "bug" | "suggestion";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialScreenshotDataUrl?: string | null;
  autoCaptureFailed?: boolean;
  /** Preselect bug vs suggestion flow. FAB passes "bug". Navbar quick-suggest stays default. */
  initialType?: FeedbackModalType;
}

interface FeedbackState {
  category: string;
  gameSystem: string;
  title: string;
  description: string;
  impact: string;
  priority: number | "";
  stepsToReproduce: string;
  severity: number | "";
  showContext: boolean;
  submitting: boolean;
  submitted: boolean;
  lastIssueNumber: number | null;
  lastGithubUrl: string | null;
  error: string | null;
}

function createInitialFeedbackState(): FeedbackState {
  return {
    category: "",
    gameSystem: "",
    title: "",
    description: "",
    impact: "",
    priority: "",
    stepsToReproduce: "",
    severity: "",
    showContext: false,
    submitting: false,
    submitted: false,
    lastIssueNumber: null,
    lastGithubUrl: null,
    error: null,
  };
}

type FeedbackAction =
  | {
      type: "SET_FIELD";
      field: "category" | "gameSystem" | "title" | "description" | "impact" | "stepsToReproduce";
      value: string;
    }
  | { type: "SET_PRIORITY"; payload: number | "" }
  | { type: "SET_SEVERITY"; payload: number | "" }
  | { type: "SET_SHOW_CONTEXT"; payload: boolean }
  | { type: "SET_SUBMITTING"; payload: boolean }
  | { type: "SUBMIT_SUCCESS"; issueNumber: number; githubUrl: string | null }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "RESET_FORM" };

function feedbackReducer(state: FeedbackState, action: FeedbackAction): FeedbackState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_PRIORITY":
      return { ...state, priority: action.payload };
    case "SET_SEVERITY":
      return { ...state, severity: action.payload };
    case "SET_SHOW_CONTEXT":
      return { ...state, showContext: action.payload };
    case "SET_SUBMITTING":
      return { ...state, submitting: action.payload, error: null };
    case "SUBMIT_SUCCESS":
      return {
        ...state,
        submitting: false,
        submitted: true,
        lastIssueNumber: action.issueNumber,
        lastGithubUrl: action.githubUrl,
        error: null,
      };
    case "SET_ERROR":
      return { ...state, error: action.payload, submitting: false };
    case "RESET_FORM":
      return createInitialFeedbackState();
    default:
      return state;
  }
}

export function FeedbackModal({
  isOpen,
  onClose,
  initialScreenshotDataUrl,
  autoCaptureFailed,
  initialType = "suggestion",
}: FeedbackModalProps) {
  const isBugMode = initialType === "bug";
  const { getContextSnapshot } = useFeedback();
  const [state, dispatch] = useReducer(feedbackReducer, undefined, createInitialFeedbackState);
  const {
    category,
    gameSystem,
    title,
    description,
    impact,
    priority,
    stepsToReproduce,
    severity,
    showContext,
    submitting,
    submitted,
    lastIssueNumber,
    lastGithubUrl,
    error,
  } = state;
  const modalRef = useRef<HTMLDivElement>(null);

  const screenshot = useScreenshotUpload({
    isOpen,
    initialScreenshotDataUrl,
    uploadEndpoint: isBugMode ? "/api/feedback/screenshot" : "/api/suggestions/screenshot",
  });

  const resetForm = useCallback(() => {
    dispatch({ type: "RESET_FORM" });
    screenshot.reset();
  }, [screenshot]);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && modalRef.current) {
      const focusable = modalRef.current.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: "SET_ERROR", payload: null });
    dispatch({ type: "SET_SUBMITTING", payload: true });
    const ctx = getContextSnapshot();

    let finalScreenshotUrl: string | undefined;
    if (
      screenshot.includeScreenshot &&
      screenshot.screenshotDataUrl &&
      !screenshot.screenshotUploadedUrl
    ) {
      const url = await screenshot.uploadScreenshot(screenshot.screenshotDataUrl);
      if (url) {
        screenshot.setScreenshotUploadedUrl(url);
        finalScreenshotUrl = url;
      }
    } else if (screenshot.includeScreenshot && screenshot.screenshotUploadedUrl) {
      finalScreenshotUrl = screenshot.screenshotUploadedUrl;
    }

    const contextPayload = {
      pathname: ctx.pathname,
      url: ctx.url,
      capturedAt: ctx.capturedAt,
      lastAction: ctx.lastAction,
      recentActions: ctx.recentActions,
      userAgent: ctx.userAgent,
      viewport: ctx.viewport,
      referrer: ctx.referrer,
    };

    try {
      if (isBugMode) {
        const body: Record<string, unknown> = {
          type: "bug",
          category: category || "other",
          title: title.trim(),
          description: description.trim(),
          context: contextPayload,
        };
        if (finalScreenshotUrl) body.screenshotUrl = finalScreenshotUrl;
        if (stepsToReproduce.trim()) body.stepsToReproduce = stepsToReproduce.trim();
        if (severity !== "") body.severity = Number(severity);

        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          dispatch({ type: "SET_ERROR", payload: data.error ?? "Failed to submit" });
          return;
        }

        dispatch({
          type: "SUBMIT_SUCCESS",
          issueNumber: data.issueNumber,
          githubUrl: data.githubIssueUrl ?? null,
        });
      } else {
        const body: Record<string, unknown> = {
          category,
          gameSystem,
          title: title.trim(),
          description: description.trim(),
          context: contextPayload,
        };
        if (finalScreenshotUrl) body.screenshotUrl = finalScreenshotUrl;
        if (impact.trim()) body.impact = impact.trim().slice(0, 500);
        if (priority !== "") body.priority = Number(priority);

        const res = await fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          dispatch({ type: "SET_ERROR", payload: data.error ?? "Failed to submit" });
          return;
        }

        dispatch({
          type: "SUBMIT_SUCCESS",
          issueNumber: data.issueNumber,
          githubUrl: data.githubIssueUrl ?? null,
        });
      }
      setTimeout(handleClose, 4000);
    } catch {
      dispatch({ type: "SET_ERROR", payload: "Network error. Please try again." });
    }
  };

  if (!isOpen) return null;

  const ctx = getContextSnapshot();
  const screenshotProps = {
    screenshotDataUrl: screenshot.screenshotDataUrl,
    includeScreenshot: screenshot.includeScreenshot,
    onIncludeChange: screenshot.setIncludeScreenshot,
    onUpload: () => screenshot.fileInputRef.current?.click(),
    onRemove: screenshot.removeScreenshot,
    onFileChange: screenshot.handleFileChange,
    fileInputRef: screenshot.fileInputRef,
    uploading: screenshot.screenshotUploading,
    error: screenshot.screenshotError,
    initialScreenshotDataUrl,
    autoCaptureFailed,
  };

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden
      />
      <div className="relative flex min-h-[100dvh] items-center justify-center p-4">
        <div
          ref={modalRef}
          className="w-full max-w-lg max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl border border-card-border bg-card shadow-modal overflow-hidden"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-card-border bg-card px-6 py-4">
            <h2 id="feedback-title" className="text-lg font-semibold">
              {isBugMode ? "Report a bug" : "Submit a suggestion"}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="space-y-5 p-6">
              {submitted ? (
                <FeedbackSuccess
                  issueNumber={lastIssueNumber}
                  githubUrl={lastGithubUrl}
                  variant={isBugMode ? "bug" : "suggestion"}
                />
              ) : isBugMode ? (
                <BugReportForm
                  category={category}
                  onCategoryChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "category", value: x })
                  }
                  title={title}
                  onTitleChange={(x) => dispatch({ type: "SET_FIELD", field: "title", value: x })}
                  description={description}
                  onDescriptionChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "description", value: x })
                  }
                  stepsToReproduce={stepsToReproduce}
                  onStepsChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "stepsToReproduce", value: x })
                  }
                  severity={severity}
                  onSeverityChange={(x) => dispatch({ type: "SET_SEVERITY", payload: x })}
                  showContext={showContext}
                  onShowContextToggle={() =>
                    dispatch({ type: "SET_SHOW_CONTEXT", payload: !showContext })
                  }
                  ctx={ctx}
                  error={error}
                  submitting={submitting}
                  onSubmit={handleSubmit}
                  onCancel={handleClose}
                  screenshotProps={screenshotProps}
                />
              ) : (
                <ReportForm
                  category={category}
                  onCategoryChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "category", value: x })
                  }
                  gameSystem={gameSystem}
                  onGameSystemChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "gameSystem", value: x })
                  }
                  title={title}
                  onTitleChange={(x) => dispatch({ type: "SET_FIELD", field: "title", value: x })}
                  description={description}
                  onDescriptionChange={(x) =>
                    dispatch({ type: "SET_FIELD", field: "description", value: x })
                  }
                  impact={impact}
                  onImpactChange={(x) => dispatch({ type: "SET_FIELD", field: "impact", value: x })}
                  priority={priority}
                  onPriorityChange={(x) => dispatch({ type: "SET_PRIORITY", payload: x })}
                  showContext={showContext}
                  onShowContextToggle={() =>
                    dispatch({ type: "SET_SHOW_CONTEXT", payload: !showContext })
                  }
                  ctx={ctx}
                  error={error}
                  submitting={submitting}
                  onSubmit={handleSubmit}
                  onCancel={handleClose}
                  screenshotProps={screenshotProps}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
