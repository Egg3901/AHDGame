"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Reaction = "like" | "dislike";

interface SuggestionVotesProps {
  issueNumber: number;
  reactions?: { like: number; dislike: number };
  userReaction?: Reaction | null;
  disabled?: boolean;
  size?: "sm" | "md";
}

const THUMB_UP =
  "M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5";
const THUMB_DOWN =
  "M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5";

/** Optimistic like/dislike toggle backed by the suggestion react endpoint. */
export function SuggestionVotes({
  issueNumber,
  reactions,
  userReaction,
  disabled,
  size = "sm",
}: SuggestionVotesProps) {
  const router = useRouter();
  const [like, setLike] = useState(reactions?.like ?? 0);
  const [dislike, setDislike] = useState(reactions?.dislike ?? 0);
  const [mine, setMine] = useState<Reaction | null>(userReaction ?? null);
  const [busy, setBusy] = useState(false);

  async function react(e: React.MouseEvent, next: Reaction) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || disabled) return;
    setBusy(true);
    const prev = { like, dislike, mine };
    const delta = (r: Reaction) => (mine === r ? -1 : 0) + (next === r && mine !== r ? 1 : 0);
    setLike(Math.max(0, like + delta("like")));
    setDislike(Math.max(0, dislike + delta("dislike")));
    setMine(mine === next ? null : next);
    const restore = () => {
      setLike(prev.like);
      setDislike(prev.dislike);
      setMine(prev.mine);
    };
    try {
      const res = await fetch(`/api/suggestions/public/${issueNumber}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: next }),
      });
      if (!res.ok) {
        restore();
        if (res.status === 401) router.push("/login");
        return;
      }
      const data = await res.json();
      setMine(data.userReaction ?? null);
      setLike(data.reactions?.like ?? 0);
      setDislike(data.reactions?.dislike ?? 0);
    } catch {
      restore();
    } finally {
      setBusy(false);
    }
  }

  const pad = size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";
  const icon = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const button = (kind: Reaction, count: number, path: string, active: string, hover: string) => (
    <button
      type="button"
      onClick={(e) => react(e, kind)}
      disabled={busy || disabled}
      aria-pressed={mine === kind}
      aria-label={kind === "like" ? "Upvote" : "Downvote"}
      className={`flex items-center gap-1.5 font-medium tabular-nums transition-colors disabled:cursor-default ${pad} ${
        mine === kind ? active : `text-muted ${disabled ? "" : hover}`
      }`}
    >
      <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
      </svg>
      {count}
    </button>
  );

  return (
    <div className="inline-flex items-stretch divide-x divide-card-border overflow-hidden rounded-lg border border-card-border bg-card-muted">
      {button("like", like, THUMB_UP, "bg-success/15 text-success", "hover:text-success")}
      {button("dislike", dislike, THUMB_DOWN, "bg-error/15 text-error", "hover:text-error")}
    </div>
  );
}
