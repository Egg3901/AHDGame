"use client";

import { useEffect, useReducer, useRef } from "react";
import Link from "next/link";

type MailComposerMode =
  | { type: "mail"; toCharacterId: string; toCharacterName: string }
  | { type: "shareholder-address"; corporationId: string; corporationName: string };

interface MailComposerModalProps {
  mode: MailComposerMode;
  onClose: () => void;
}

interface State {
  subject: string;
  body: string;
  submitting: boolean;
  error: string | null;
  sent: boolean;
  retryAfterSeconds: number | null;
}

type Action =
  | { type: "SET_SUBJECT"; value: string }
  | { type: "SET_BODY"; value: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "SUBMIT_RATE_LIMITED"; retryAfter: number }
  | { type: "SUBMIT_SUCCESS" };

const initialState: State = {
  subject: "",
  body: "",
  submitting: false,
  error: null,
  sent: false,
  retryAfterSeconds: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_SUBJECT":
      return { ...state, subject: action.value };
    case "SET_BODY":
      return { ...state, body: action.value };
    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.error };
    case "SUBMIT_RATE_LIMITED":
      return { ...state, submitting: false, error: null, retryAfterSeconds: action.retryAfter };
    case "SUBMIT_SUCCESS":
      return { ...state, submitting: false, sent: true };
    default:
      return state;
  }
}

export function MailComposerModal({ mode, onClose }: MailComposerModalProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Auto-close after success
  useEffect(() => {
    if (state.sent) {
      autoCloseRef.current = setTimeout(onClose, 1500);
    }
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, [state.sent, onClose]);

  const insertFormatting = (marker: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = state.body.slice(start, end);
    const wrapped = selected ? `${marker}${selected}${marker}` : `${marker}${marker}`;
    const newBody = state.body.slice(0, start) + wrapped + state.body.slice(end);
    dispatch({ type: "SET_BODY", value: newBody });

    // Move cursor: if no selection, place between markers; otherwise after closing marker
    requestAnimationFrame(() => {
      if (!textarea) return;
      if (selected) {
        const pos = start + marker.length + selected.length + marker.length;
        textarea.setSelectionRange(pos, pos);
      } else {
        const pos = start + marker.length;
        textarea.setSelectionRange(pos, pos);
      }
      textarea.focus();
    });
  };

  const handleSubmit = async () => {
    if (!state.body.trim()) {
      dispatch({ type: "SUBMIT_ERROR", error: "Message body is required." });
      return;
    }
    if (mode.type === "mail" && !state.subject.trim()) {
      dispatch({ type: "SUBMIT_ERROR", error: "Subject is required." });
      return;
    }

    dispatch({ type: "SUBMIT_START" });

    try {
      let res: Response;
      if (mode.type === "mail") {
        res = await fetch("/api/mail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toCharacterId: mode.toCharacterId,
            subject: state.subject,
            body: state.body,
          }),
        });
      } else {
        res = await fetch(`/api/corporations/${mode.corporationId}/shareholder-address`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: state.body }),
        });
      }

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const retryAfter = data.retryAfter ?? parseInt(res.headers.get("Retry-After") || "60");
        dispatch({ type: "SUBMIT_RATE_LIMITED", retryAfter });
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        dispatch({ type: "SUBMIT_ERROR", error: data.error || "Failed to send." });
        return;
      }

      dispatch({ type: "SUBMIT_SUCCESS" });
    } catch {
      dispatch({ type: "SUBMIT_ERROR", error: "Failed to send." });
    }
  };

  const bodyRemaining = 1000 - state.body.length;
  const isMail = mode.type === "mail";

  const formatCooldown = (seconds: number) => {
    if (isMail) return null; // mail uses countdown timer (not needed for shareholder address)
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="rounded-2xl border border-card-border bg-card p-6 w-full max-w-lg shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">
            {isMail ? "Send Mail" : "Shareholder Address"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {/* To field */}
          <p className="text-xs text-muted">
            {isMail ? (
              <>
                To:{" "}
                <Link
                  href={`/character/${mode.toCharacterId}`}
                  className="text-primary hover:underline"
                >
                  {mode.toCharacterName}
                </Link>
              </>
            ) : (
              "To: All Shareholders"
            )}
          </p>

          {/* Subject (mail mode only) */}
          {isMail && (
            <div className="space-y-1">
              <label className="text-xs text-muted">Subject</label>
              <input
                type="text"
                maxLength={80}
                value={state.subject}
                onChange={(e) => dispatch({ type: "SET_SUBJECT", value: e.target.value })}
                placeholder="Subject"
                className="w-full rounded-lg border border-card-border bg-zinc-950 px-3 py-2 text-sm text-foreground focus:border-zinc-500 focus:outline-none"
              />
            </div>
          )}

          {/* Formatting toolbar */}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => insertFormatting("**")}
              className="px-2 py-1 rounded border border-card-border bg-card-elevated text-xs font-bold text-foreground hover:bg-card-border transition-colors"
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("*")}
              className="px-2 py-1 rounded border border-card-border bg-card-elevated text-xs italic text-foreground hover:bg-card-border transition-colors"
              title="Italic"
            >
              I
            </button>
          </div>

          {/* Body textarea */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <label className="text-xs text-muted">Message</label>
              <span className={`text-xs ${bodyRemaining < 100 ? "text-error" : "text-muted/60"}`}>
                {bodyRemaining}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              maxLength={1000}
              rows={6}
              value={state.body}
              onChange={(e) => dispatch({ type: "SET_BODY", value: e.target.value })}
              placeholder="Write your message..."
              className="w-full rounded-lg border border-card-border bg-zinc-950 px-3 py-2 text-sm text-foreground focus:border-zinc-500 focus:outline-none resize-none"
            />
          </div>

          {/* Status messages */}
          {state.sent && <p className="text-xs text-emerald-400">Sent.</p>}

          {state.retryAfterSeconds !== null && (
            <p className="text-xs text-yellow-400">
              {isMail
                ? `Rate limited. Try again in ${state.retryAfterSeconds}s.`
                : `Cooldown active. ${formatCooldown(state.retryAfterSeconds)}`}
            </p>
          )}

          {state.error && <p className="text-xs text-red-400">{state.error}</p>}

          {/* Submit */}
          {!state.sent && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={state.submitting || state.retryAfterSeconds !== null}
              className="w-full rounded-lg border border-blue-600/40 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.submitting ? "Sending..." : isMail ? "Send Mail" : "Send Address"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
