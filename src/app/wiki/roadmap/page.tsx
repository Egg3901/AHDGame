"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface RoadmapItem {
  _id: string;
  title: string;
  description?: string;
  phase: "alpha" | "beta" | "release";
  status: "planned" | "in-progress" | "completed";
  completedAt?: string;
  sortOrder: number;
  category?: string;
  subcategory?: string;
}

interface RoadmapCategory {
  _id: string;
  name: string;
  subcategories: string[];
  sortOrder: number;
}

const PHASES = [
  { id: "alpha" as const, label: "Alpha", version: "v0.0.x" },
  { id: "beta" as const, label: "Beta", version: "v0.x.x" },
  { id: "release" as const, label: "Release", version: "vx.x.x" },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "bg-zinc-500/20 text-zinc-400" },
  "in-progress": { label: "In Progress", className: "bg-yellow-500/20 text-yellow-400" },
  completed: { label: "Completed", className: "bg-green-500/20 text-green-400" },
};

function ItemRow({ item }: { item: RoadmapItem }) {
  const badge = STATUS_BADGE[item.status];
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          item.status === "completed"
            ? "bg-green-500/20 text-green-400"
            : item.status === "in-progress"
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-zinc-500/20 text-zinc-400"
        }`}
      >
        {item.status === "completed" ? "✓" : item.status === "in-progress" ? "●" : "○"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              item.status === "completed" ? "text-muted line-through" : "text-foreground"
            }`}
          >
            {item.title}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
        {item.completedAt && (
          <p className="mt-0.5 text-xs text-green-400/70">
            Completed {new Date(item.completedAt).toLocaleDateString("en-US")}
          </p>
        )}
      </div>
    </li>
  );
}

function MiniProgressBar({ items }: { items: RoadmapItem[] }) {
  const completed = items.filter((i) => i.status === "completed").length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-background">
        <div
          className="h-1.5 rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted">
        {completed}/{total}
      </span>
    </div>
  );
}

export default function WikiRoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [categories, setCategories] = useState<RoadmapCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/roadmap")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        setItems(data.items ?? []);
        setCategories(data.categories ?? []);
      })
      .catch(() => setError("Failed to load roadmap"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground">
          Wiki
        </Link>
        <span>/</span>
        <span>Roadmap</span>
      </nav>

      <header className="mb-10">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">Product Roadmap</h1>
        <p className="text-lg text-muted">
          Track what&apos;s planned, in progress, and completed across each release phase.
        </p>
      </header>

      {loading && <div className="py-12 text-center text-muted">Loading roadmap...</div>}
      {error && <div className="py-12 text-center text-red-400">{error}</div>}

      {!loading && !error && (
        <div className="space-y-10">
          {PHASES.map((phase) => {
            const phaseItems = items
              .filter((i) => i.phase === phase.id)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            const completed = phaseItems.filter((i) => i.status === "completed").length;
            const total = phaseItems.length;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            // Group by category
            const sortedCats = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
            const categorized = sortedCats
              .map((cat) => ({
                cat,
                items: phaseItems.filter((i) => i.category === cat.name),
              }))
              .filter((g) => g.items.length > 0);
            const uncategorized = phaseItems.filter((i) => !i.category);

            return (
              <section key={phase.id} className="rounded-xl border border-card-border bg-card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-foreground">
                    {phase.label}{" "}
                    <span className="text-sm font-normal text-muted">({phase.version})</span>
                  </h2>
                  <span className="text-sm text-muted">
                    {completed}/{total} ({pct}%)
                  </span>
                </div>

                <div className="mb-6 h-2 rounded-full bg-background">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {total === 0 ? (
                  <p className="text-sm text-muted">No items yet for this phase.</p>
                ) : (
                  <div className="space-y-6">
                    {categorized.map(({ cat, items: catItems }) => {
                      // Group by subcategory within category
                      const subcatGroups: { label: string | null; items: RoadmapItem[] }[] = [];
                      const usedSubs = new Set<string>();

                      for (const sub of cat.subcategories) {
                        const subItems = catItems.filter((i) => i.subcategory === sub);
                        if (subItems.length > 0) {
                          subcatGroups.push({ label: sub, items: subItems });
                          usedSubs.add(sub);
                        }
                      }
                      const noSubItems = catItems.filter(
                        (i) => !i.subcategory || !usedSubs.has(i.subcategory)
                      );
                      if (noSubItems.length > 0) {
                        subcatGroups.unshift({ label: null, items: noSubItems });
                      }

                      return (
                        <div key={cat._id}>
                          <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground">{cat.name}</h3>
                            <MiniProgressBar items={catItems} />
                          </div>
                          <div className="space-y-3">
                            {subcatGroups.map((group) => (
                              <div key={group.label ?? "__none"}>
                                {group.label && (
                                  <p className="mb-1 ml-2 text-xs font-medium text-muted">
                                    {group.label}
                                  </p>
                                )}
                                <ul className={`space-y-2 ${group.label ? "ml-4" : ""}`}>
                                  {group.items.map((item) => (
                                    <ItemRow key={item._id} item={item} />
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {uncategorized.length > 0 && (
                      <div>
                        {categorized.length > 0 && (
                          <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground">General</h3>
                            <MiniProgressBar items={uncategorized} />
                          </div>
                        )}
                        <ul className="space-y-2">
                          {uncategorized.map((item) => (
                            <ItemRow key={item._id} item={item} />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
