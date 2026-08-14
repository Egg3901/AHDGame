"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { InboxItem } from "@/lib/inbox";
import type { MailMessage } from "@/lib/inbox/mailThreads";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/time/LocalTime";

interface MailThreadViewProps {
  item: InboxItem;
  onArchive: () => void;
  onSent?: () => void;
}

const QUICK_REPLIES = [
  "Understood, thanks.",
  "I'll look into this.",
  "Can we discuss further?",
  "Agreed.",
];

const RATE_LIMIT_MS = 60_000;

export function MailThreadView({ item, onArchive, onSent }: MailThreadViewProps) {
  const [messages, setMessages] = useState<MailMessage[]>(item.messages ?? []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rateLimitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local state when switching threads — otherwise optimistic sends leak
  // into the next conversation the user opens. Only key off thread id so inbox
  // refetches do not wipe an in-progress draft.
  useEffect(() => {
    setMessages(item.messages ?? []);
    setDraft("");
    setSending(false);
    setRateLimited(false);
    setReported(false);
    setReporting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset keys off thread id only; adding item.messages would wipe an in-progress draft on every inbox refetch
  }, [item.id]);

  const latestReceivedMailId = useMemo(
    () => [...(item.messages ?? [])].reverse().find((m) => m.from === "them" && m.id)?.id,
    [item.messages]
  );

  const handleReport = useCallback(async () => {
    if (!latestReceivedMailId || reported || reporting) return;
    setReporting(true);
    try {
      const res = await fetch(`/api/mail/${latestReceivedMailId}/report`, { method: "POST" });
      if (res.ok || res.status === 409) setReported(true);
    } finally {
      setReporting(false);
    }
  }, [latestReceivedMailId, reported, reporting]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (rateLimitTimer.current) clearTimeout(rateLimitTimer.current);
    };
  }, []);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !item.counterpartId) return;

    const optimistic: MailMessage = {
      from: "you",
      time: new Date().toISOString(),
      body,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSending(true);

    try {
      const res = await fetch("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toCharacterId: item.counterpartId,
          subject: `Re: ${item.title}`,
          body,
        }),
      });

      if (res.status === 429) {
        setRateLimited(true);
        rateLimitTimer.current = setTimeout(() => setRateLimited(false), RATE_LIMIT_MS);
        return;
      }

      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m !== optimistic));
        setDraft(body);
        return;
      }

      onSent?.();
    } catch {
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [draft, item.counterpartId, item.title, onSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send();
      }
    },
    [send]
  );

  const canSend = draft.trim().length > 0 && !!item.counterpartId && !sending;

  return (
    <div className="flex h-full flex-col">
      {/* Sender header */}
      <div className="flex items-center justify-between gap-3 border-b border-card-border px-5 py-4">
        <div className="flex items-center gap-3">
          <Avatar name={item.counterpartName ?? "?"} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {item.counterpartName ?? "Unknown"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latestReceivedMailId && (
            <button
              type="button"
              onClick={() => void handleReport()}
              disabled={reported || reporting}
              className="text-xs text-muted transition-colors hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
            >
              {reported ? "Reported" : reporting ? "Reporting…" : "Report"}
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={onArchive} aria-label="Archive">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            Archive
          </Button>
        </div>
      </div>

      {/* Subject */}
      <div className="border-b border-card-border px-5 py-3">
        <h2 className="font-serif text-base font-semibold text-foreground">{item.title}</h2>
      </div>

      {/* Message bubbles */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((msg, i) => {
          const isYou = msg.from === "you";
          return (
            <div key={i} className={`flex ${isYou ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  isYou
                    ? "bg-primary/15 text-foreground rounded-br-sm"
                    : "bg-card-elevated text-foreground rounded-bl-sm",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <p>{msg.body}</p>
                {msg.time && (
                  <p
                    className={`mt-1 text-[10px] ${isYou ? "text-primary/60 text-right" : "text-muted"}`}
                  >
                    <LocalTime value={msg.time} options={{ hour: "2-digit", minute: "2-digit" }} />
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Rate-limit notice */}
      {rateLimited && (
        <p className="px-5 py-1 text-xs text-warning">
          You can send one message per minute. Please wait a moment.
        </p>
      )}

      {/* Quick-reply chips */}
      <div className="flex flex-wrap gap-2 px-5 py-2">
        {QUICK_REPLIES.map((reply) => (
          <button
            key={reply}
            type="button"
            onClick={() => setDraft(reply)}
            className="rounded-full border border-card-border bg-card px-3 py-1 text-xs text-muted transition-colors hover:border-primary/30 hover:text-foreground"
          >
            {reply}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-card-border px-5 py-4">
        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="Write a reply… (⌘↵ to send)"
            className="flex-1 resize-none rounded-xl border border-card-border bg-card-elevated px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!canSend}
            isLoading={sending}
            onClick={() => void send()}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
