"use client";

import Link from "next/link";
import { AuthorAvatar } from "./AuthorAvatar";
import { PlayerBadge } from "./PlayerBadge";
import type { CountryId } from "@/lib/constants/countries";

export interface ForumAuthor {
  name: string | null;
  avatarUrl: string | null;
  characterId: string | null;
  partyAbbrev: string | null;
  stateCode: string | null;
  countryId: CountryId | null;
}

interface ForumPostProps {
  author: ForumAuthor;
  /** Small tag under the author, e.g. "Original poster". */
  role?: string;
  /** Left side of the post header (time, post number). */
  meta: React.ReactNode;
  /** Right side of the post header. */
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  emphasis?: boolean;
  id?: string;
}

/** One post in a suggestion thread: author rail on the left, body on the right. */
export function ForumPost({
  author,
  role,
  meta,
  headerAction,
  footer,
  children,
  emphasis,
  id,
}: ForumPostProps) {
  const name = author.name ?? "Unknown player";
  return (
    <article
      id={id}
      className={`grid scroll-mt-24 rounded-xl border bg-card sm:grid-cols-[168px_1fr] ${
        emphasis ? "border-primary/30 shadow-lg" : "border-card-border shadow-md"
      }`}
    >
      <aside className="flex items-center gap-3 rounded-t-xl border-b border-card-border bg-card-muted px-4 py-3 sm:flex-col sm:items-center sm:gap-2 sm:rounded-l-xl sm:rounded-tr-none sm:border-b-0 sm:border-r sm:px-3 sm:py-5 sm:text-center">
        <AuthorAvatar name={name} url={author.avatarUrl} size={emphasis ? "lg" : "md"} />
        <div className="min-w-0 sm:flex sm:flex-col sm:items-center sm:gap-1">
          {author.characterId ? (
            <Link
              href={`/character/${author.characterId}`}
              className="block truncate text-sm font-semibold text-foreground hover:text-primary sm:max-w-[148px] sm:whitespace-normal sm:break-words"
            >
              {name}
            </Link>
          ) : (
            <span className="block truncate text-sm font-semibold text-foreground sm:max-w-[148px] sm:whitespace-normal">
              {name}
            </span>
          )}
          <PlayerBadge
            partyAbbrev={author.partyAbbrev}
            stateCode={author.stateCode}
            countryId={author.countryId}
          />
          {role && (
            <span className="mt-0.5 inline-block rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {role}
            </span>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 py-2 text-xs text-muted sm:px-5">
          <div className="flex min-w-0 items-center gap-2">{meta}</div>
          {headerAction}
        </header>
        <div className="flex-1 px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-card-border bg-card-muted/40 px-4 sm:rounded-bl-none py-2 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </article>
  );
}
