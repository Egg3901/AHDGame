"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react";
import type { ChangelogPost } from "@/lib/changelog/types";
import { formatDate } from "../changelogUtils";
import { ChangelogMarkdown } from "../components/ChangelogMarkdown";
import { BADGE_STYLES, TAG_CHIP_CLASSES } from "../components/postStyles";
import { estimateReadingMinutes } from "@/lib/changelog/postUtils";

/**
 * A single release as a full-width readable post.
 *
 * Deliberately narrower than the feed (max-w-3xl vs max-w-4xl): this is long-form
 * body copy, and a measure of roughly 70 characters is what keeps it readable.
 * The feed is a scannable index and can afford to be wider.
 */
export function ChangelogPostView({
  post,
  newer,
  older,
}: {
  post: ChangelogPost;
  newer: ChangelogPost | null;
  older: ChangelogPost | null;
}) {
  const minutes = estimateReadingMinutes(post.body);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-20">
      <Link
        href="/changelog"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All releases
      </Link>

      <article>
        <header className="mb-8 border-b border-card-border pb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-primary">v{post.version}</span>
            <span className="text-sm text-muted">{formatDate(post.date)}</span>
            <span className="text-sm text-muted">·</span>
            <span className="text-sm text-muted">{minutes} min read</span>
            {post.era && (
              <span className="rounded-full border border-card-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {post.era}
              </span>
            )}
          </div>

          <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
            {post.title}
          </h1>

          {post.summary && (
            <p className="mt-3 text-base leading-relaxed text-muted">{post.summary}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.badges.map((badge) => {
              const style = BADGE_STYLES[badge];
              return (
                <span
                  key={badge}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
                >
                  {style.label}
                </span>
              );
            })}
            {post.tags.map((tag) => (
              <span key={tag} className={TAG_CHIP_CLASSES}>
                {tag}
              </span>
            ))}
          </div>
        </header>

        <ChangelogMarkdown content={post.body} />
      </article>

      {(newer || older) && (
        <nav className="mt-12 grid gap-3 border-t border-card-border pt-6 sm:grid-cols-2">
          {newer ? (
            <Link
              href={`/changelog/${newer.slug}`}
              className="group rounded-xl border border-card-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
                <ArrowLeft className="h-3 w-3" />
                Newer
              </span>
              <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
                v{newer.version} · {newer.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {older && (
            <Link
              href={`/changelog/${older.slug}`}
              className="group rounded-xl border border-card-border bg-card p-4 text-right transition-colors hover:border-primary/40 sm:col-start-2"
            >
              <span className="flex items-center justify-end gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Older
                <ArrowRight className="h-3 w-3" />
              </span>
              <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
                v{older.version} · {older.title}
              </span>
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
