"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { ChangelogPost } from "@/lib/changelog/types";
import { fetchJson } from "@/lib/observability/fetchJson";
import {
  collectUniqueEras,
  collectUniqueTags,
  groupPostsByMonth,
  postMatchesFilters,
} from "@/lib/changelog/postUtils";
import { ChangelogPostCard } from "./components/ChangelogPostCard";
import { ChangelogFeedFilter } from "./components/ChangelogFeedFilter";
import { MonthDivider } from "./components/MonthDivider";
import { AdminVersionBlock } from "./components/AdminVersionBlock";
import { classifyItem, parseAdminChangelog } from "./changelogUtils";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import { AdSenseUnit } from "@/components/AdSenseUnit";
import { LocalTime } from "@/components/time/LocalTime";

interface ChangelogClientProps {
  publicPosts: ChangelogPost[];
}

export function ChangelogClient({ publicPosts }: ChangelogClientProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [eraFilter, setEraFilter] = useState("all");
  const [badgeFilter, setBadgeFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [devPosts, setDevPosts] = useState<ChangelogPost[]>([]);
  const [showLegacyDev, setShowLegacyDev] = useState(false);
  const [legacyDevMarkdown, setLegacyDevMarkdown] = useState("");
  const [legacyCollapsed, setLegacyCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    fetchJson<{ user?: { isAdmin?: boolean } }>("/api/auth/me", { feature: "changelog-viewer" })
      .then((d) => {
        if (d.user?.isAdmin) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAdmin || devPosts.length > 0) return;
    fetchJson<{ posts?: ChangelogPost[] }>("/api/admin/changelog", {
      feature: "changelog-admin",
    })
      .then((d) => {
        if (d?.posts) setDevPosts(d.posts);
      })
      .catch(() => {});
  }, [isAdmin, devPosts.length]);

  useEffect(() => {
    if (!showLegacyDev || legacyDevMarkdown) return;
    fetchJson<{ changelog?: string }>("/api/admin/changelog/legacy", {
      feature: "changelog-legacy",
    })
      .then((d) => {
        if (d?.changelog) setLegacyDevMarkdown(d.changelog);
      })
      .catch(() => {});
  }, [showLegacyDev, legacyDevMarkdown]);

  const activePosts = adminView ? devPosts : publicPosts;

  const allTags = useMemo(() => collectUniqueTags(activePosts), [activePosts]);
  const allEras = useMemo(() => collectUniqueEras(activePosts), [activePosts]);

  const filteredPosts = useMemo(
    () =>
      activePosts.filter((post) =>
        postMatchesFilters(post, {
          search,
          tag: tagFilter,
          badge: badgeFilter,
          era: eraFilter,
          area: adminView ? areaFilter : undefined,
        })
      ),
    [activePosts, search, tagFilter, badgeFilter, eraFilter, areaFilter, adminView]
  );

  const groupedPosts = useMemo(() => groupPostsByMonth(filteredPosts), [filteredPosts]);

  const legacyAdminBlocks = useMemo(
    () =>
      (legacyDevMarkdown ? parseAdminChangelog(legacyDevMarkdown) : []).map((block) => ({
        ...block,
        sections: block.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => classifyItem(item, section.heading)),
        })),
      })),
    [legacyDevMarkdown]
  );

  const latestVersion = activePosts[0]?.version ?? "—";
  const oldestDate = activePosts.at(-1)?.date;
  const sinceLabel = oldestDate ? (
    <LocalTime value={oldestDate + "T00:00:00"} options={{ month: "short", year: "numeric" }} />
  ) : (
    "—"
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-20">
      <header className="relative mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
        <div className="relative h-[175px] w-full sm:h-[220px]">
          <HeroImage
            src="/api/images/hero/changelog"
            alt="DEC VT100 terminal"
            fill
            className="object-cover object-[center_55%]"
            sizes="(max-width: 896px) 100vw, 896px"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="flex items-end justify-between">
              <div>
                <h1 className="mb-1 text-3xl font-bold tracking-tight text-white">
                  {adminView ? "Developer Changelog" : "What\u2019s New"}
                </h1>
                <p className="text-sm text-white/70">
                  {adminView
                    ? "Per-release technical notes from v0.4.0 onward."
                    : "Release notes for A House Divided. Open a release to read the full post."}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setAdminView(!adminView)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    adminView
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "border-white/20 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {adminView ? "\u25C8 Dev View" : "\u25C7 Dev View"}
                </button>
              )}
            </div>
          </div>
        </div>

        <HeroStatsStrip>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Latest</span>
            <span className="text-base font-bold tabular-nums text-primary">v{latestVersion}</span>
          </div>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Releases</span>
            <span className="text-base font-bold tabular-nums text-foreground">
              {activePosts.length}
            </span>
          </div>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Feed since</span>
            <span className="text-base font-bold tabular-nums text-foreground">{sinceLabel}</span>
          </div>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Archive</span>
            <Link
              href="/changelog/legacy"
              className="text-base font-bold text-foreground hover:text-primary"
            >
              Pre-0.4.0
            </Link>
          </div>
        </HeroStatsStrip>
      </header>

      <div className="mb-6">
        <ChangelogFeedFilter
          search={search}
          onSearchChange={setSearch}
          tags={allTags}
          eras={allEras}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          eraFilter={eraFilter}
          onEraFilterChange={setEraFilter}
          badgeFilter={badgeFilter}
          onBadgeFilterChange={setBadgeFilter}
          showAreaFilter={adminView}
          areaFilter={areaFilter}
          onAreaFilterChange={setAreaFilter}
          resultCount={filteredPosts.length}
        />
      </div>

      {filteredPosts.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">
          No releases match the current filters.
        </div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-3 left-[7px] top-3 w-px bg-card-border" />
          <div className="space-y-8">
            {groupedPosts.map((group, groupIdx) => (
              <div key={group.month} className="space-y-6">
                <MonthDivider month={group.month} />
                {group.posts.map((post, i) => {
                  const isFirstOverall = groupIdx === 0 && i === 0;
                  return (
                    <div key={post.slug}>
                      <ChangelogPostCard
                        post={post}
                        isLatest={isFirstOverall && !search.trim() && tagFilter === "all"}
                        showAreas={adminView}
                        linkToPost={!adminView}
                      />
                      {isFirstOverall && !adminView && (
                        <div className="mt-6">
                          <AdSenseUnit
                            slot="ahd-changelog-native"
                            format="auto"
                            className="min-h-[90px]"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {adminView && (
        <div className="mt-10 border-t border-card-border pt-6">
          <button
            type="button"
            onClick={() => setShowLegacyDev(!showLegacyDev)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showLegacyDev ? "Hide" : "Show"} developer history before v0.4.0
          </button>
          {showLegacyDev && legacyAdminBlocks.length > 0 && (
            <div className="mt-4 space-y-3">
              {legacyAdminBlocks.map((block, blockIdx) => (
                <AdminVersionBlock
                  key={`${block.version}-${blockIdx}`}
                  block={block}
                  blockIdx={blockIdx}
                  isCollapsed={legacyCollapsed.has(block.version)}
                  isLatest={false}
                  onToggleCollapse={(version) =>
                    setLegacyCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(version)) next.delete(version);
                      else next.add(version);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-muted">
        Looking for older player-facing notes?{" "}
        <Link href="/changelog/legacy" className="text-primary hover:underline">
          Browse the legacy changelog
        </Link>{" "}
        (pre-v0.4.0).
      </p>
    </div>
  );
}
