"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Task, TaskPriority } from "@/lib/db/types";
import { TaskFormToast } from "./TaskFormToast";
import { LocalTime } from "@/components/time/LocalTime";

interface SummaryData {
  total: number;
  byStatus: {
    pending: number;
    in_progress: number;
    completed: number;
  };
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topPriority: Task[];
  completedTasks: Task[];
}

function getPriorityBadge(priority: TaskPriority) {
  switch (priority) {
    case "critical":
      return (
        <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Crit
        </span>
      );
    case "high":
      return (
        <span className="bg-orange-500/10 text-orange-500 border border-orange-500/20 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          High
        </span>
      );
    case "medium":
      return (
        <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Med
        </span>
      );
    case "low":
      return (
        <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Low
        </span>
      );
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case "bug":
      return "🐛";
    case "feature":
      return "✨";
    case "improvement":
      return "⚡";
    default:
      return "📋";
  }
}

export function TasksWidget() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadSummary = useCallback(() => {
    fetch("/api/admin/tasks/summary")
      .then((r) => (r.ok ? r.json() : Promise.reject("Failed to load")))
      .then((json: SummaryData) => setData(json))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <p className="text-sm text-muted">Loading tasks...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <p className="text-sm text-muted">Failed to load tasks</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 divide-x divide-card-border border-b border-card-border">
          <div className="p-4 bg-red-500/5">
            <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider">Critical</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{data.byPriority.critical}</p>
          </div>
          <div className="p-4 bg-orange-500/5">
            <p className="text-[10px] text-orange-500 font-bold uppercase tracking-wider">High</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{data.byPriority.high}</p>
          </div>
          <div className="p-4 bg-blue-500/5">
            <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Active</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{data.byStatus.in_progress}</p>
          </div>
          <div className="p-4 bg-card-muted/30">
            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">Pending</p>
            <p className="text-2xl font-bold mt-1 text-foreground">{data.byStatus.pending}</p>
          </div>
        </div>

        {/* Active Tasks List */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Top Priority</h3>
            <button
              onClick={() => setShowForm(true)}
              className="text-xs font-medium text-primary hover:text-primary-dark transition-colors flex items-center gap-1"
            >
              <span className="text-lg leading-none">+</span> New Task
            </button>
          </div>

          <div className="space-y-2">
            {data.topPriority.length === 0 ? (
              <div className="text-sm text-muted py-6 text-center bg-card-muted/20 rounded-lg border border-dashed border-card-border">
                No active tasks pending
              </div>
            ) : (
              data.topPriority.map((task) => (
                <Link
                  key={task._id.toString()}
                  href={`/admin/tasks?task=${task._id}`}
                  className="group flex items-center gap-3 text-sm border border-card-border bg-card-elevated/50 rounded-lg p-2.5 hover:bg-card-elevated hover:border-primary/20 transition-all shadow-sm"
                >
                  <div className="shrink-0 w-8 flex justify-center text-lg" title={task.type}>
                    {getTypeIcon(task.type)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-foreground truncate">{task.title}</span>
                      {task.status === "in_progress" && (
                        <span
                          className="shrink-0 w-2 h-2 rounded-full bg-blue-500 animate-pulse"
                          title="In Progress"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {getPriorityBadge(task.priority)}
                      <span>•</span>
                      <span className="capitalize">{task.type}</span>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recently Completed */}
      {data.completedTasks.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card/50 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Recently Completed
            </h3>
            <Link
              href="/admin/tasks?status=completed"
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              View All
            </Link>
          </div>

          <div className="space-y-2 opacity-75 hover:opacity-100 transition-opacity">
            {data.completedTasks.map((task) => (
              <Link
                key={task._id.toString()}
                href={`/admin/tasks?task=${task._id}`}
                className="flex items-center gap-3 text-sm p-2 rounded hover:bg-card-muted/50 transition-colors"
              >
                <div className="shrink-0 text-green-500">✓</div>
                <span className="flex-1 truncate text-muted line-through decoration-muted/50">
                  {task.title}
                </span>
                <span className="text-xs text-muted/60">
                  <LocalTime value={task.updatedAt} options={{ dateStyle: "medium" }} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="text-center">
        <Link
          href="/admin/tasks"
          className="text-xs font-medium text-muted hover:text-foreground transition-colors border-b border-transparent hover:border-muted inline-block pb-0.5"
        >
          Open Task Board →
        </Link>
      </div>

      {showForm && (
        <TaskFormToast
          onCreated={() => {
            setShowForm(false);
            loadSummary();
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
