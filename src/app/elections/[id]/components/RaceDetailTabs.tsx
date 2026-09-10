"use client";

import React, { useEffect, useState } from "react";

export interface RaceDetailPane {
  id: string;
  label: string;
  content: React.ReactNode;
  /**
   * A hash that should open this pane. `#state-org` is a live deep link from
   * the campaign manager and from the presidential primary page, and landing on
   * the section with the pane you were sent to hidden behind a tab is worse
   * than not moving it at all.
   */
  hash?: string;
}

/**
 * The race's detail views, one at a time.
 *
 * These used to run down the page one after another — two full maps of the
 * United States, a trends chart, the state drivers and the factor ledger —
 * so reading any one of them meant scrolling past the rest. They answer
 * different questions and none of them is the page's headline, which the
 * hero above already carries.
 *
 * The section sits where the electoral map used to, because that map has to
 * lead: everything below it decomposes what it shows.
 */
export function RaceDetailTabs({
  panes,
  title = "Detail",
}: {
  panes: RaceDetailPane[];
  title?: string;
}) {
  const [activeId, setActiveId] = useState<string>(panes[0]?.id ?? "");

  const hashPanes = panes.filter((p) => p.hash).map((p) => [p.hash!, p.id] as const);
  const hashKey = hashPanes.map(([h, id]) => `${h}:${id}`).join(",");

  useEffect(() => {
    const sync = () => {
      const match = hashPanes.find(([h]) => window.location.hash === h);
      if (match) setActiveId(match[1]);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // `hashKey` stands in for the pane list: the effect only cares which
    // hashes map to which pane, not the identity of the content nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashKey]);

  if (panes.length === 0) return null;

  // A lone pane has nothing to swap to, so the strip would be chrome around a
  // single view.
  const active = panes.find((p) => p.id === activeId) ?? panes[0];

  return (
    <section
      id={panes.find((p) => p.hash)?.hash?.slice(1)}
      className="scroll-mt-6"
      aria-label={title}
    >
      {panes.length > 1 && (
        <div
          role="tablist"
          aria-label={title}
          className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-card-border bg-card p-1"
        >
          {panes.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === active.id}
              onClick={() => setActiveId(p.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                p.id === active.id
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Every pane stays mounted. The presence map fetches its own state list,
          the electoral map holds a selected state and the drivers hold a
          selected one of their own; unmounting on each switch would throw all
          of that away and refetch. */}
      {panes.map((p) => (
        <div key={p.id} hidden={p.id !== active.id} role="tabpanel">
          {p.content}
        </div>
      ))}
    </section>
  );
}
