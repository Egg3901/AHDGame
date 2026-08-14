"use client";

import { useState, useEffect, useCallback } from "react";
import { LocalTime } from "@/components/time/LocalTime";

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

export function RoadmapManager() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [categories, setCategories] = useState<RoadmapCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState<Record<string, string>>({
    alpha: "",
    beta: "",
    release: "",
  });
  const [newDesc, setNewDesc] = useState<Record<string, string>>({
    alpha: "",
    beta: "",
    release: "",
  });
  const [newCategory, setNewCategory] = useState<Record<string, string>>({
    alpha: "",
    beta: "",
    release: "",
  });
  const [newSubcategory, setNewSubcategory] = useState<Record<string, string>>({
    alpha: "",
    beta: "",
    release: "",
  });
  const [saving, setSaving] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newSubcatInputs, setNewSubcatInputs] = useState<Record<string, string>>({});

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roadmap");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setItems(data.items);
    } catch {
      setError("Failed to load roadmap items");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roadmap/categories");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setCategories(data.categories);
    } catch {
      setError("Failed to load categories");
    }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchCategories();
  }, [fetchItems, fetchCategories]);

  const addItem = async (phase: string) => {
    const title = newTitle[phase]?.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      const body: Record<string, string | undefined> = {
        title,
        description: newDesc[phase]?.trim() || undefined,
        phase,
      };
      if (newCategory[phase]) body.category = newCategory[phase];
      if (newSubcategory[phase]) body.subcategory = newSubcategory[phase];

      const res = await fetch("/api/admin/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create");
      setNewTitle((p) => ({ ...p, [phase]: "" }));
      setNewDesc((p) => ({ ...p, [phase]: "" }));
      setNewCategory((p) => ({ ...p, [phase]: "" }));
      setNewSubcategory((p) => ({ ...p, [phase]: "" }));
      await fetchItems();
    } catch {
      setError("Failed to add item");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item: RoadmapItem) => {
    const nextStatus =
      item.status === "completed"
        ? "planned"
        : item.status === "planned"
          ? "in-progress"
          : "completed";
    try {
      const res = await fetch(`/api/admin/roadmap/${item._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchItems();
    } catch {
      setError("Failed to update item");
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this roadmap item?")) return;
    try {
      const res = await fetch(`/api/admin/roadmap/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchItems();
    } catch {
      setError("Failed to delete item");
    }
  };

  const moveItem = async (item: RoadmapItem, direction: "up" | "down") => {
    const phaseItems = items
      .filter((i) => i.phase === item.phase)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = phaseItems.findIndex((i) => i._id === item._id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= phaseItems.length) return;

    const other = phaseItems[swapIdx];
    try {
      await Promise.all([
        fetch(`/api/admin/roadmap/${item._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: other.sortOrder }),
        }),
        fetch(`/api/admin/roadmap/${other._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: item.sortOrder }),
        }),
      ]);
      await fetchItems();
    } catch {
      setError("Failed to reorder");
    }
  };

  const updateItemCategory = async (
    item: RoadmapItem,
    category: string | null,
    subcategory: string | null
  ) => {
    try {
      const res = await fetch(`/api/admin/roadmap/${item._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subcategory }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchItems();
    } catch {
      setError("Failed to update category");
    }
  };

  // Category management
  const addCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/admin/roadmap/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create");
      setNewCatName("");
      await fetchCategories();
    } catch {
      setError("Failed to add category");
    }
  };

  const deleteCategory = async (cat: RoadmapCategory) => {
    if (!confirm(`Delete "${cat.name}"? Items using this category will become uncategorized.`))
      return;
    try {
      const res = await fetch(`/api/admin/roadmap/categories/${cat._id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await Promise.all([fetchCategories(), fetchItems()]);
    } catch {
      setError("Failed to delete category");
    }
  };

  const addSubcategory = async (cat: RoadmapCategory) => {
    const sub = newSubcatInputs[cat._id]?.trim();
    if (!sub) return;
    const updated = [...cat.subcategories, sub];
    try {
      const res = await fetch(`/api/admin/roadmap/categories/${cat._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcategories: updated }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setNewSubcatInputs((p) => ({ ...p, [cat._id]: "" }));
      await fetchCategories();
    } catch {
      setError("Failed to add subcategory");
    }
  };

  const removeSubcategory = async (cat: RoadmapCategory, sub: string) => {
    const updated = cat.subcategories.filter((s) => s !== sub);
    try {
      const res = await fetch(`/api/admin/roadmap/categories/${cat._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcategories: updated }),
      });
      if (!res.ok) throw new Error("Failed to update");
      await fetchCategories();
    } catch {
      setError("Failed to remove subcategory");
    }
  };

  const moveCat = async (cat: RoadmapCategory, direction: "up" | "down") => {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((c) => c._id === cat._id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const other = sorted[swapIdx];
    try {
      await Promise.all([
        fetch(`/api/admin/roadmap/categories/${cat._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: other.sortOrder }),
        }),
        fetch(`/api/admin/roadmap/categories/${other._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: cat.sortOrder }),
        }),
      ]);
      await fetchCategories();
    } catch {
      setError("Failed to reorder categories");
    }
  };

  if (loading) return <div className="text-muted">Loading roadmap...</div>;

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-bold text-foreground">Roadmap Manager</h2>
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* Category Management */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <button
          onClick={() => setCatOpen(!catOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-foreground">Manage Categories</h3>
          <span className="text-muted">{catOpen ? "▲" : "▼"}</span>
        </button>

        {catOpen && (
          <div className="mt-4 space-y-3">
            {categories
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((cat, idx) => (
                <div
                  key={cat._id}
                  className="rounded-lg border border-card-border bg-background p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-foreground text-sm flex-1">{cat.name}</span>
                    <button
                      onClick={() => moveCat(cat, "up")}
                      disabled={idx === 0}
                      className="text-xs text-muted hover:text-foreground disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => moveCat(cat, "down")}
                      disabled={idx === categories.length - 1}
                      className="text-xs text-muted hover:text-foreground disabled:opacity-30"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => deleteCategory(cat)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {cat.subcategories.map((sub) => (
                      <span
                        key={sub}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        {sub}
                        <button
                          onClick={() => removeSubcategory(cat, sub)}
                          className="text-primary/60 hover:text-primary"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newSubcatInputs[cat._id] || ""}
                      onChange={(e) =>
                        setNewSubcatInputs((p) => ({ ...p, [cat._id]: e.target.value }))
                      }
                      placeholder="Add subcategory..."
                      className="flex-1 rounded border border-card-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted"
                      onKeyDown={(e) => e.key === "Enter" && addSubcategory(cat)}
                    />
                    <button
                      onClick={() => addSubcategory(cat)}
                      className="rounded bg-primary/20 px-2 py-1 text-xs text-primary hover:bg-primary/30"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}

            <div className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="New category name..."
                className="flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
              />
              <button
                onClick={addCategory}
                disabled={!newCatName.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
              >
                Add Category
              </button>
            </div>
          </div>
        )}
      </div>

      {PHASES.map((phase) => {
        const phaseItems = items
          .filter((i) => i.phase === phase.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const completed = phaseItems.filter((i) => i.status === "completed").length;
        const total = phaseItems.length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const selectedCat = categories.find((c) => c.name === newCategory[phase.id]);

        return (
          <div key={phase.id} className="rounded-xl border border-card-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                {phase.label}{" "}
                <span className="text-sm font-normal text-muted">({phase.version})</span>
              </h3>
              <span className="text-sm text-muted">
                {completed}/{total} complete ({pct}%)
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-4 h-2 rounded-full bg-background">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Items */}
            <div className="space-y-2">
              {phaseItems.map((item, idx) => (
                <div
                  key={item._id}
                  className={`flex items-center gap-3 rounded-lg border border-card-border px-3 py-2 ${
                    item.status === "completed" ? "opacity-60" : ""
                  }`}
                >
                  {/* Status toggle */}
                  <button
                    onClick={() => toggleStatus(item)}
                    aria-label={`Status: ${item.status}. Click to cycle.`}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                      item.status === "completed"
                        ? "border-green-500 bg-green-500/20 text-green-400"
                        : item.status === "in-progress"
                          ? "border-yellow-500 bg-yellow-500/20 text-yellow-400"
                          : "border-card-border text-transparent hover:border-muted"
                    }`}
                    title={`Status: ${item.status}. Click to cycle.`}
                  >
                    {item.status === "completed" ? "✓" : item.status === "in-progress" ? "●" : ""}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${item.status === "completed" ? "line-through text-muted" : "text-foreground"}`}
                      >
                        {item.title}
                      </span>
                      {item.category && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {item.category}
                          {item.subcategory ? ` / ${item.subcategory}` : ""}
                        </span>
                      )}
                    </div>
                    {item.description && <p className="text-xs text-muted">{item.description}</p>}
                    {item.completedAt && (
                      <p className="text-xs text-green-400/70">
                        Completed{" "}
                        <LocalTime value={item.completedAt} options={{ dateStyle: "medium" }} />
                      </p>
                    )}
                  </div>

                  {/* Category inline edit */}
                  <select
                    value={item.category || ""}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      updateItemCategory(item, val, null);
                    }}
                    className="rounded border border-card-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                    title="Category"
                  >
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  {item.category &&
                    (() => {
                      const cat = categories.find((c) => c.name === item.category);
                      return cat && cat.subcategories.length > 0 ? (
                        <select
                          value={item.subcategory || ""}
                          onChange={(e) =>
                            updateItemCategory(item, item.category!, e.target.value || null)
                          }
                          className="rounded border border-card-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                          title="Subcategory"
                        >
                          <option value="">None</option>
                          {cat.subcategories.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : null;
                    })()}

                  {/* Reorder buttons */}
                  <button
                    onClick={() => moveItem(item, "up")}
                    disabled={idx === 0}
                    aria-label="Move up"
                    title="Move up"
                    className="text-xs text-muted hover:text-foreground disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveItem(item, "down")}
                    disabled={idx === phaseItems.length - 1}
                    aria-label="Move down"
                    title="Move down"
                    className="text-xs text-muted hover:text-foreground disabled:opacity-30"
                  >
                    ▼
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => deleteItem(item._id)}
                    className="text-xs text-red-400 hover:text-red-300"
                    title="Delete"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Add item form */}
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTitle[phase.id]}
                  onChange={(e) => setNewTitle((p) => ({ ...p, [phase.id]: e.target.value }))}
                  placeholder="New item title..."
                  className="flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
                  onKeyDown={(e) => e.key === "Enter" && addItem(phase.id)}
                />
                <input
                  type="text"
                  value={newDesc[phase.id]}
                  onChange={(e) => setNewDesc((p) => ({ ...p, [phase.id]: e.target.value }))}
                  placeholder="Description (optional)"
                  className="flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
                  onKeyDown={(e) => e.key === "Enter" && addItem(phase.id)}
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={newCategory[phase.id]}
                  onChange={(e) => {
                    setNewCategory((p) => ({ ...p, [phase.id]: e.target.value }));
                    setNewSubcategory((p) => ({ ...p, [phase.id]: "" }));
                  }}
                  className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c._id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {selectedCat && selectedCat.subcategories.length > 0 && (
                  <select
                    value={newSubcategory[phase.id]}
                    onChange={(e) =>
                      setNewSubcategory((p) => ({ ...p, [phase.id]: e.target.value }))
                    }
                    className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground"
                  >
                    <option value="">No subcategory</option>
                    {selectedCat.subcategories.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => addItem(phase.id)}
                  disabled={!newTitle[phase.id]?.trim() || saving}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
