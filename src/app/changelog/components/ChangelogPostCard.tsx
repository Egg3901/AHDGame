"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ChangelogPost } from "@/lib/changelog/types";
import { formatDate } from "../changelogUtils";
import { estimateReadingMinutes } from "@/lib/changelog/postUtils";
import { ChangelogMarkdown } from "./ChangelogMarkdown";
import { AREA_STYLES, BADGE_STYLES, TAG_CHIP_CLASSES } from "./postStyles";

interface ChangelogPostCardProps {
  post: ChangelogPost;
  isLatest?: boolean;
  showAreas?: boolean;
  /** Dev-view posts have no public page, so the card stays inert there. */
  linkToPost?: boolean;
}

/**
 * One release in the feed: headline, date, summary, labels, and a link out.
 *
 * This used to expand the whole release body inline. With entries running to a
 * couple of hundred lines that turned the feed into a wall of accordions where
 * nothing was scannable and nothing was linkable. The body now lives at
 * /changelog/[slug]; the card's only job is to make you decide whether to open
 * it.
 */
export function ChangelogPostCard({
  post,
  isLatest = false,
  showAreas = false,
  linkToPost = true,
}: ChangelogPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const minutes = estimateReadingMinutes(post.body);

  const header = (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span
          className={`font-mono text-sm font-bold ${isLatest ? "text-primary" : "text-foreground"}`}
        >
          v{post.version}
        </span>
        <span className="text-xs text-muted">{formatDate(post.date)}</span>
        <span className="text-xs text-muted">·</span>
        <span className="text-xs text-muted">{minutes} min read</span>
        {post.era && (
          <span className="rounded-full border border-card-border bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            {post.era}
          </span>
        )}
        {isLatest && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            Latest
          </span>
        )}
      </div>
      <h2 className="text-base font-semibold text-foreground">{post.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{post.summary}</p>
    </>
  );

  return (
    <article className="relative pl-8">
      <div
        className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 ${
          isLatest ? "border-primary bg-primary/20" : "border-card-border bg-card"
        }`}
      />

      {linkToPost ? (
        <Link href={`/changelog/${post.slug}`} className="group block">
          {header}
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
            Read the full post
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      ) : (
        <div>
          {header}
          {/* Dev posts have no public page to link to, so they keep the
              expand-in-place body they have always had. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "Hide notes" : "Show notes"}
          </button>
          {expanded && (
            <div className="mt-3 border-t border-card-border pt-3">
              <ChangelogMarkdown content={post.body} compact />
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
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
        {showAreas &&
          post.areas?.map((area) => {
            const style = AREA_STYLES[area];
            return (
              <span
                key={area}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
              >
                {style.label}
              </span>
            );
          })}
      </div>
    </article>
  );
}
