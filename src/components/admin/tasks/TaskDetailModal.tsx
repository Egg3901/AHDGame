"use client";

import { useState, useEffect } from "react";
import type { Task, TaskStatus } from "@/lib/db/types";
import type { TaskComment } from "@/lib/db/types/taskComment";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const PRIORITY_CLASSES: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  low: "bg-green-500/10 text-green-500 border-green-500/20",
};

const TYPE_ICONS: Record<string, string> = {
  bug: "🐛",
  feature: "✨",
  improvement: "⚡",
};

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}

export function TaskDetailModal({ task, onClose, onStatusChange, onDelete }: TaskDetailModalProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsError, setCommentsError] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentStatus, setCommentStatus] = useState<TaskStatus | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/tasks/${task._id}/comments`)
      // Reject with a real Error: bare reject() surfaces in GlitchTip as
      // "Non-Error promise rejection captured with value: undefined".
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`Task comments fetch failed: ${r.status}`))
      )
      .then((json: { comments: TaskComment[] }) => setComments(json.comments))
      .catch(() => setCommentsError(true));
  }, [task._id]);

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    onDelete(task._id.toString());
    onClose();
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSubmitting(true);
    setCommentError("");
    try {
      const res = await fetch(`/api/admin/tasks/${task._id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: commentBody,
          ...(commentStatus ? { statusChange: commentStatus } : {}),
        }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setComments((prev) => [...prev, comment]);
        setCommentBody("");
        setCommentStatus("");
        if (commentStatus) onStatusChange(task, commentStatus as TaskStatus);
      } else {
        setCommentError("Failed to post comment.");
      }
    } catch {
      setCommentError("Failed to post comment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl pointer-events-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-5 border-b border-card-border">
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-2xl mt-0.5 shrink-0">{TYPE_ICONS[task.type] ?? "📋"}</span>
              <h2 className="font-semibold text-lg leading-snug">{task.title}</h2>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="text-muted hover:text-foreground transition-colors text-xl leading-none shrink-0 mt-0.5"
            >
              ×
            </button>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-card-border flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${PRIORITY_CLASSES[task.priority]}`}
            >
              {task.priority}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-card-border text-muted">
              {task.type}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-muted">Status:</label>
              <select
                value={task.status}
                onChange={(e) => onStatusChange(task, e.target.value as TaskStatus)}
                className="h-7 rounded border border-card-border bg-card-elevated px-2 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="p-5">
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {task.description}
            </p>
          </div>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-5 pb-3">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Comment History */}
          {commentsError ? (
            <div className="border-t border-card-border px-5 py-3">
              <p className="text-xs text-red-400">Failed to load comments.</p>
            </div>
          ) : comments.length > 0 ? (
            <div className="border-t border-card-border px-5 py-4 space-y-3 max-h-48 overflow-y-auto">
              {comments.map((c) => (
                <div key={c._id.toString()} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        c.author === "claude"
                          ? "bg-purple-500/20 text-purple-400"
                          : "bg-blue-500/20 text-blue-400"
                      }`}
                    >
                      {c.author === "claude" ? "Claude" : "User"}
                    </span>
                    {c.statusChange && (
                      <span className="text-[10px] text-muted">
                        → {c.statusChange.replace("_", " ")}
                      </span>
                    )}
                    <span className="text-[10px] text-muted ml-auto">
                      {new Date(c.createdAt).toLocaleString("en-US")}
                    </span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Add Comment Form */}
          <form
            onSubmit={handleAddComment}
            className="border-t border-card-border px-5 py-4 space-y-2"
          >
            <textarea
              placeholder="Add a comment..."
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={2}
              className="w-full rounded border border-card-border bg-card-elevated px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            {commentError && <p className="text-xs text-red-400">{commentError}</p>}
            <div className="flex items-center gap-2">
              <select
                value={commentStatus}
                onChange={(e) => setCommentStatus(e.target.value as TaskStatus | "")}
                className="h-7 rounded border border-card-border bg-card-elevated px-2 text-xs text-muted focus:border-primary focus:outline-none"
              >
                <option value="">No status change</option>
                <option value="pending">→ Pending</option>
                <option value="in_progress">→ In Progress</option>
                <option value="completed">→ Completed</option>
              </select>
              <button
                type="submit"
                disabled={submitting || !commentBody.trim()}
                className="ml-auto px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {submitting ? "Posting..." : "Post"}
              </button>
            </div>
          </form>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-card-border bg-card-muted/30">
            <button
              onClick={handleDelete}
              className="text-xs text-muted hover:text-red-500 transition-colors"
            >
              Delete task
            </button>
            <span className="text-xs text-muted">
              Created {new Date(task.createdAt).toLocaleDateString("en-US")}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
