"use client";

import { useState, useEffect } from "react";
import type { Task, TaskType, TaskStatus, TaskPriority } from "@/lib/db/types";
import type { TaskLesson, LessonCategory } from "@/lib/db/types/taskLesson";
import { TaskFormToast } from "@/components/admin/tasks/TaskFormToast";
import { TaskDetailModal } from "@/components/admin/tasks/TaskDetailModal";
import { HealingTools } from "@/components/admin/tasks/HealingTools";
import { useSearchParams, useRouter } from "next/navigation";

function getPriorityBadge(priority: TaskPriority) {
  switch (priority) {
    case "critical":
      return (
        <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Critical
        </span>
      );
    case "high":
      return (
        <span className="bg-orange-500/10 text-orange-500 border border-orange-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          High
        </span>
      );
    case "medium":
      return (
        <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Medium
        </span>
      );
    case "low":
      return (
        <span className="bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
          Low
        </span>
      );
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case "bug":
      return <span title="Bug">🐛</span>;
    case "feature":
      return <span title="Feature">✨</span>;
    case "improvement":
      return <span title="Improvement">⚡</span>;
    default:
      return <span title="Task">📋</span>;
  }
}

export function TasksPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "lessons">("tasks");

  const selectedTaskId = searchParams.get("task") ?? searchParams.get("edit");
  const selectedTask = tasks.find((t) => t._id.toString() === selectedTaskId) ?? null;

  function openTask(id: string) {
    router.push(`/admin/tasks?task=${id}`, { scroll: false });
  }

  function closeTask() {
    router.push("/admin/tasks", { scroll: false });
  }

  // Filters
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">(
    (searchParams.get("status") as TaskStatus) || "all"
  );
  const [typeFilter, setTypeFilter] = useState<TaskType | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");

  useEffect(() => {
    fetch("/api/admin/tasks")
      .then((r) => (r.ok ? r.json() : Promise.reject("Failed")))
      .then((json: { tasks: Task[] }) => setTasks(json.tasks))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  async function updateStatus(task: Task, newStatus: TaskStatus) {
    const res = await fetch(`/api/admin/tasks/${task._id.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const { task: updated } = (await res.json()) as { task: Task };
      setTasks((prev) =>
        prev.map((t) => (t._id.toString() === updated._id.toString() ? updated : t))
      );
    }
  }

  async function deleteTask(id: string) {
    if (!confirm("Are you sure you want to delete this task?")) return;
    const res = await fetch(`/api/admin/tasks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t._id.toString() !== id));
    }
  }

  const filteredTasks = tasks.filter((task) => {
    if (typeFilter !== "all" && task.type !== typeFilter) return false;
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
    return true;
  });

  // Separate active vs completed if showing all
  const showSeparated = statusFilter === "all";
  const activeTasks = filteredTasks.filter((t) => t.status !== "completed");
  const completedTasks = filteredTasks.filter((t) => t.status === "completed");

  return (
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-card-border">
        {(["tasks", "lessons"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab === "tasks" ? "Tasks" : "Lessons Learned"}
          </button>
        ))}
      </div>

      {activeTab === "lessons" ? (
        <LessonsTab />
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header & Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "all")}
                className="h-9 rounded-md border border-card-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "all")}
                className="h-9 rounded-md border border-card-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Priority</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TaskType | "all")}
                className="h-9 rounded-md border border-card-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Types</option>
                <option value="bug">Bugs</option>
                <option value="feature">Features</option>
                <option value="improvement">Improvements</option>
              </select>
            </div>

            <button
              onClick={() => setShowForm(true)}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              + New Task
            </button>

            {/* Healing Tools */}
            <HealingTools />
          </div>

          {/* Task Lists */}
          <div className="space-y-8">
            {showSeparated ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted uppercase tracking-wider flex items-center gap-2">
                    Active Tasks{" "}
                    <span className="bg-card-border px-1.5 py-0.5 rounded text-xs text-foreground">
                      {activeTasks.length}
                    </span>
                  </h3>
                  <TaskList
                    tasks={activeTasks}
                    onStatusChange={updateStatus}
                    onDelete={deleteTask}
                    onSelect={openTask}
                  />
                </section>

                {completedTasks.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted uppercase tracking-wider flex items-center gap-2">
                      Completed{" "}
                      <span className="bg-green-500/20 text-green-500 px-1.5 py-0.5 rounded text-xs">
                        {completedTasks.length}
                      </span>
                    </h3>
                    <TaskList
                      tasks={completedTasks}
                      onStatusChange={updateStatus}
                      onDelete={deleteTask}
                      onSelect={openTask}
                      isCompleted
                    />
                  </section>
                )}
              </>
            ) : (
              <TaskList
                tasks={filteredTasks}
                onStatusChange={updateStatus}
                onDelete={deleteTask}
                onSelect={openTask}
                isCompleted={statusFilter === "completed"}
              />
            )}
          </div>

          {showForm && (
            <TaskFormToast
              onCreated={(task) => {
                setTasks((prev) => [task, ...prev]);
                setShowForm(false);
              }}
              onClose={() => setShowForm(false)}
            />
          )}
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={closeTask}
          onStatusChange={(task, status) => updateStatus(task, status)}
          onDelete={(id) => {
            deleteTask(id);
            closeTask();
          }}
        />
      )}
    </div>
  );
}

const LESSON_CATEGORY_CLASSES: Record<LessonCategory, string> = {
  bug: "bg-red-500/20 text-red-400",
  design: "bg-purple-500/20 text-purple-400",
  process: "bg-blue-500/20 text-blue-400",
  technical: "bg-cyan-500/20 text-cyan-400",
  general: "bg-gray-500/20 text-gray-400",
};

const LESSON_CATEGORIES: LessonCategory[] = ["bug", "design", "process", "technical", "general"];

interface LessonWithTask extends TaskLesson {
  taskTitle: string | null;
}

function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    ),
  ];
}

function LessonCard({
  lesson,
  onUpdated,
}: {
  lesson: LessonWithTask;
  onUpdated: (updated: LessonWithTask) => void;
}) {
  const [editingTags, setEditingTags] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  const tags = lesson.tags ?? [];
  const [tagsInput, setTagsInput] = useState(tags.join(", "));
  const [saving, setSaving] = useState(false);

  async function saveTags() {
    const tags = parseTags(tagsInput);
    setSaving(true);
    const res = await fetch(`/api/admin/tasks/lessons/${lesson._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (res.ok) {
      const { lesson: updated } = await res.json();
      onUpdated({ ...updated, taskTitle: lesson.taskTitle });
    }
    setSaving(false);
    setEditingTags(false);
  }

  async function saveCategory(category: LessonCategory) {
    const res = await fetch(`/api/admin/tasks/lessons/${lesson._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (res.ok) {
      const { lesson: updated } = await res.json();
      onUpdated({ ...updated, taskTitle: lesson.taskTitle });
    }
    setEditingCategory(false);
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {editingCategory ? (
          <div className="flex items-center gap-1">
            {LESSON_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => saveCategory(cat)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded transition-opacity hover:opacity-80 ${LESSON_CATEGORY_CLASSES[cat]} ${cat === lesson.category ? "ring-1 ring-current" : "opacity-60"}`}
              >
                {cat}
              </button>
            ))}
            <button onClick={() => setEditingCategory(false)} className="text-xs text-muted ml-1">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingCategory(true)}
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded transition-opacity hover:opacity-70 ${LESSON_CATEGORY_CLASSES[lesson.category]}`}
            title="Click to change category"
          >
            {lesson.category}
          </button>
        )}
        {lesson.taskTitle && <span className="text-xs text-muted">re: {lesson.taskTitle}</span>}
        <span className="ml-auto text-xs text-muted">
          {new Date(lesson.createdAt).toLocaleDateString("en-US")}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{lesson.lesson}</p>
      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
          >
            #{tag}
          </span>
        ))}
        {editingTags ? (
          <div className="flex items-center gap-1 ml-1 flex-1 min-w-0">
            <input
              autoFocus
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTags();
                }
                if (e.key === "Escape") setEditingTags(false);
              }}
              placeholder="tag1, tag2, ..."
              className="flex-1 min-w-0 rounded border border-card-border bg-card-elevated px-2 py-0.5 text-xs placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={saveTags}
              disabled={saving}
              className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {saving ? "…" : "Save"}
            </button>
            <button onClick={() => setEditingTags(false)} className="text-xs text-muted">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setTagsInput(tags.join(", "));
              setEditingTags(true);
            }}
            className="text-[10px] text-muted hover:text-foreground transition-colors px-1"
            title="Edit tags"
          >
            {tags.length === 0 ? "+ add tags" : "edit tags"}
          </button>
        )}
      </div>
    </div>
  );
}

function LessonsTab() {
  const [lessons, setLessons] = useState<LessonWithTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<LessonCategory | "all">("all");

  useEffect(() => {
    fetch("/api/admin/tasks/lessons")
      .then((r) => (r.ok ? r.json() : Promise.reject("Failed")))
      .then((json: { lessons: LessonWithTask[] }) => setLessons(json.lessons))
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, []);

  function handleUpdated(updated: LessonWithTask) {
    setLessons((prev) =>
      prev.map((l) => (l._id.toString() === updated._id.toString() ? updated : l))
    );
  }

  const filtered =
    categoryFilter === "all" ? lessons : lessons.filter((l) => l.category === categoryFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as LessonCategory | "all")}
          className="h-9 rounded-md border border-card-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="all">All Categories</option>
          {LESSON_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} className="capitalize">
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {filtered.length} lesson{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-card-border p-12 text-center text-sm text-muted">
          {lessons.length === 0
            ? "No lessons learned yet. Claude logs these after completing tasks."
            : "No lessons match this filter."}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((lesson) => (
            <LessonCard key={lesson._id.toString()} lesson={lesson} onUpdated={handleUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  onStatusChange,
  onDelete,
  onSelect,
  isCompleted = false,
}: {
  tasks: Task[];
  onStatusChange: (t: Task, s: TaskStatus) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  isCompleted?: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-card-border p-8 text-center text-sm text-muted">
        No tasks found in this section.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {tasks.map((task) => (
        <div
          key={task._id.toString()}
          className={`group relative flex flex-col gap-3 rounded-xl border p-4 transition-all sm:flex-row sm:items-start sm:gap-4 ${
            isCompleted
              ? "border-card-border bg-card/50 opacity-75 hover:opacity-100"
              : "border-card-border bg-card hover:border-primary/20 hover:shadow-sm"
          }`}
        >
          {/* Status Checkbox/Icon */}
          <div className="pt-0.5">
            <button
              onClick={() => onStatusChange(task, isCompleted ? "in_progress" : "completed")}
              className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                isCompleted
                  ? "border-green-500 bg-green-500 text-white"
                  : "border-muted hover:border-primary hover:text-primary"
              }`}
              title={isCompleted ? "Mark as active" : "Mark as completed"}
            >
              {isCompleted ? (
                "✓"
              ) : (
                <div className="h-2 w-2 rounded-full bg-current opacity-0 hover:opacity-100" />
              )}
            </button>
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSelect(task._id.toString())}
                  className={`font-medium leading-none text-left hover:underline ${isCompleted ? "line-through text-muted" : "text-foreground"}`}
                >
                  {task.title}
                </button>
                {task.status === "in_progress" && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-500">
                    In Progress
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <select
                  value={task.status}
                  onChange={(e) => onStatusChange(task, e.target.value as TaskStatus)}
                  className="h-6 rounded border border-card-border bg-background px-1 text-xs text-muted focus:border-primary focus:outline-none"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
                <button
                  onClick={() => onDelete(task._id.toString())}
                  className="text-muted hover:text-red-500"
                  title="Delete task"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {task.description && (
              <p className="text-sm text-muted line-clamp-2">{task.description}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
              <div className="flex items-center gap-1.5" title="Type">
                {getTypeIcon(task.type)}
                <span className="capitalize">{task.type}</span>
              </div>
              <div className="h-3 w-px bg-card-border" />
              {getPriorityBadge(task.priority)}
              <div className="h-3 w-px bg-card-border" />
              <span>Created {new Date(task.createdAt).toLocaleDateString("en-US")}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
