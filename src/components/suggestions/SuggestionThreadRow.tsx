"use client";

import Link from "next/link";
import { AuthorAvatar } from "./AuthorAvatar";
import { CategoryBadge } from "./CategoryBadge";
import { DiscordDiscussLink } from "./DiscordDiscussLink";
import { PlayerBadge } from "./PlayerBadge";
import { StatusBadge } from "./StatusBadge";
import { SuggestionVotes } from "./SuggestionVotes";
import { RelativeTime } from "@/components/time/LocalTime";
import type { CountryId } from "@/lib/constants/countries";

export interface SuggestionThreadItem {
  id: string;
  issueNumber: number;
  category: string;
  gameSystem: string;
  title: string;
  descriptionPreview?: string;
  status: string;
  screenshotUrl: string | null;
  commentCount: number;
  unreadCommentCount?: number;
  reactions?: { like: number; dislike: number };
  userReaction?: "like" | "dislike" | null;
  discordUrl?: string | null;
  reporterCharacterName?: string | null;
  reporterAvatarUrl?: string | null;
  reporterPartyAbbrev?: string | null;
  reporterStateCode?: string | null;
  reporterCountryId?: CountryId | null;
  createdAt: string;
}

/** Grid shared by the thread list header and every row. */
export const THREAD_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 md:grid-cols-[auto_minmax(0,1fr)_128px_76px_124px]";

interface Props {
  item: SuggestionThreadItem;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

/** One suggestion as a forum thread row: author, title and preview, votes, replies, status. */
export function SuggestionThreadRow({ item, selectMode, selected, onToggleSelect }: Props) {
  const unread = item.unreadCommentCount ?? 0;
  const replies = (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="font-semibold text-foreground">{item.commentCount}</span>
      <span className="text-muted md:hidden">{item.commentCount === 1 ? "reply" : "replies"}</span>
      {unread > 0 && (
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {unread} new
        </span>
      )}
    </span>
  );

  return (
    <li
      className={`group relative ${THREAD_GRID} px-4 py-3.5 transition-colors ${
        selected ? "bg-primary/10" : "hover:bg-card-elevated/60"
      }`}
    >
      <div className="flex items-center gap-3 self-start pt-0.5">
        {selectMode && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.(item.id)}
            aria-label={`Select S#${item.issueNumber}`}
            className="relative z-10 h-4 w-4 accent-[var(--primary)]"
          />
        )}
        <AuthorAvatar name={item.reporterCharacterName} url={item.reporterAvatarUrl} />
      </div>

      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <Link
            href={`/feedback/${item.issueNumber}`}
            className="line-clamp-2 font-semibold text-foreground md:line-clamp-1 after:absolute after:inset-0 group-hover:text-primary"
          >
            {item.title}
          </Link>
          {item.screenshotUrl && (
            <span className="mt-0.5 shrink-0 text-muted" title="Has a screenshot">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-label="Has a screenshot"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </span>
          )}
        </div>
        {item.descriptionPreview && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted">{item.descriptionPreview}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-mono">S#{item.issueNumber}</span>
          <CategoryBadge
            category={item.category as "feature_request"}
            gameSystem={item.gameSystem as "elections"}
          />
          <span className="inline-flex items-center gap-1">
            by
            <span className="font-medium text-foreground/90">
              {item.reporterCharacterName ?? "Unknown player"}
            </span>
            <PlayerBadge
              partyAbbrev={item.reporterPartyAbbrev ?? null}
              stateCode={item.reporterStateCode ?? null}
              countryId={item.reporterCountryId ?? null}
            />
          </span>
          <RelativeTime value={item.createdAt} />
          {item.discordUrl && (
            <span className="relative z-10">
              <DiscordDiscussLink href={item.discordUrl} compact />
            </span>
          )}
        </div>
      </div>

      {/* Stats: a row under the text on narrow screens, their own columns from md up */}
      <div className="col-start-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs md:contents">
        <div className="relative z-10 md:flex md:justify-center">
          <SuggestionVotes
            issueNumber={item.issueNumber}
            reactions={item.reactions}
            userReaction={item.userReaction}
          />
        </div>
        <div className="md:flex md:justify-center md:text-sm">{replies}</div>
        <div className="md:flex md:justify-end">
          <StatusBadge status={item.status} />
        </div>
      </div>
    </li>
  );
}
