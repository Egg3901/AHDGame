"use client";

import { useEffect, useState } from "react";
import { WikiReviewActions } from "./WikiReviewActions";

interface PendingPage {
  _id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  status: string;
  authorName: string;
  createdAt: string;
  originalContent?: string;
  originalTitle?: string;
  originalDescription?: string;
}

export function WikiReviewTab() {
  const [pending, setPending] = useState<PendingPage[]>([]);
  const [selected, setSelected] = useState<PendingPage | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPending = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/wiki/review-queue");
      if (response.ok) {
        const data = await response.json();
        // API returns { pending: WikiPage[] }; normalize into the component's
        // PendingPage shape.
        const pages: PendingPage[] = (data.pending ?? []).map((p: Record<string, unknown>) => ({
          _id: String(p._id),
          slug: String(p.slug),
          title: String(p.title),
          description: String(p.description ?? ""),
          content: String(p.content ?? ""),
          tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
          difficulty: p.difficulty as PendingPage["difficulty"],
          status: String(p.status ?? "pending_review"),
          authorName:
            (p.submitterName as string | undefined) ??
            (p.authorName as string | undefined) ??
            "Unknown",
          createdAt: String(p.createdAt ?? ""),
        }));
        setPending(pages);
      }
    } catch (error) {
      console.error("Failed to load pending pages:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  if (loading) {
    return <div className="text-muted">Loading pending submissions...</div>;
  }

  if (pending.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">No pending wiki submissions</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">
          Pending Wiki Submissions ({pending.length})
        </h2>
      </div>

      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelected(null)}
              className="text-sm text-primary hover:text-primary/80"
            >
              ← Back to list
            </button>
            <WikiReviewActions
              slug={selected.slug}
              onApprove={() => {
                loadPending();
                setSelected(null);
              }}
              onReject={() => {
                loadPending();
                setSelected(null);
              }}
            />
          </div>

          <div className="bg-card border border-card-border rounded-lg p-6">
            <h3 className="text-lg font-bold text-foreground mb-2">{selected.title}</h3>
            <p className="text-sm text-muted mb-4">
              By {selected.authorName} • {new Date(selected.createdAt).toLocaleDateString("en-US")}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {selected.originalContent && (
                <div>
                  <h4 className="text-sm font-medium text-muted mb-2">Original</h4>
                  <div className="bg-background border border-card-border rounded p-4 max-h-96 overflow-y-auto">
                    <div className="prose prose-sm prose-invert max-w-none">
                      {selected.originalContent}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium text-muted mb-2">
                  {selected.originalContent ? "Proposed Changes" : "New Content"}
                </h4>
                <div className="bg-background border border-card-border rounded p-4 max-h-96 overflow-y-auto">
                  <div className="prose prose-sm prose-invert max-w-none">{selected.content}</div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm">
                <span className="font-medium">Description:</span> {selected.description}
              </p>
              <p className="text-sm">
                <span className="font-medium">Tags:</span> {selected.tags.join(", ") || "None"}
              </p>
              {selected.difficulty && (
                <p className="text-sm">
                  <span className="font-medium">Difficulty:</span> {selected.difficulty}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg divide-y divide-card-border">
          {pending.map((page) => (
            <div
              key={page._id}
              className="p-4 hover:bg-muted cursor-pointer"
              onClick={() => setSelected(page)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-foreground">{page.title}</h3>
                  <p className="text-sm text-muted mt-1">{page.description}</p>
                  <p className="text-xs text-muted mt-2">
                    By {page.authorName} • {new Date(page.createdAt).toLocaleDateString("en-US")}
                  </p>
                </div>
                <span className="px-3 py-1 text-xs font-medium bg-warning/20 border border-warning/30 text-warning rounded-full">
                  {page.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
