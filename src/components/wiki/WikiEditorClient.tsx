"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useWikiEditorState } from "@/hooks/useWikiEditorState";
import { createWikiPageSchema } from "@/lib/api/schemas/wiki";
import { PLAYER_SUBMITTABLE_CATEGORY_IDS, getCategoryById } from "@/lib/wiki/categories";
import { useToast } from "@/contexts/ToastContext";
import { WikiEditorToolbar } from "./WikiEditorToolbar";
import { TemplateSelector } from "./TemplateSelector";
import { MarkdownContent } from "./MarkdownContent";

interface WikiEditorClientProps {
  mode: "create" | "edit";
  isAdmin: boolean;
  initialSlug?: string;
  initialCategory?: string;
  initialData?: {
    title: string;
    description: string;
    content: string;
    category?: string;
    tags: string[];
    difficulty?: "beginner" | "intermediate" | "advanced";
    featured?: boolean;
    private?: boolean;
  };
}

export function WikiEditorClient({
  mode,
  isAdmin,
  initialSlug,
  initialCategory,
  initialData,
}: WikiEditorClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { state, dispatch } = useWikiEditorState();
  const [tagInput, setTagInput] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Load initial data for edit mode
  useEffect(() => {
    if (mode === "edit" && initialData) {
      dispatch({ type: "SET_FIELD", field: "title", value: initialData.title });
      dispatch({ type: "SET_FIELD", field: "description", value: initialData.description });
      dispatch({ type: "SET_FIELD", field: "content", value: initialData.content });
      dispatch({ type: "SET_FIELD", field: "tags", value: initialData.tags });
      if (initialData.category) {
        dispatch({ type: "SET_FIELD", field: "category", value: initialData.category });
      }
      if (initialData.difficulty) {
        dispatch({ type: "SET_FIELD", field: "difficulty", value: initialData.difficulty });
      }
      if (initialData.featured !== undefined) {
        dispatch({ type: "SET_FIELD", field: "featured", value: initialData.featured });
      }
      if (initialData.private !== undefined) {
        dispatch({ type: "SET_FIELD", field: "private", value: initialData.private });
      }
      dispatch({ type: "SET_FIELD", field: "slug", value: initialSlug || "" });
    }
  }, [mode, initialData, initialSlug, dispatch]);

  // Prefill category for create mode (e.g. /wiki/new?category=events)
  useEffect(() => {
    if (mode === "create" && initialCategory) {
      dispatch({ type: "SET_FIELD", field: "category", value: initialCategory });
    }
  }, [mode, initialCategory, dispatch]);

  // Auto-save to localStorage
  useEffect(() => {
    if (!state.isDirty) return;

    const draftKey = mode === "edit" ? `wiki-draft-edit-${initialSlug}` : "wiki-draft-new";
    const timeout = setTimeout(() => {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          title: state.title,
          description: state.description,
          content: state.content,
          tags: state.tags,
          difficulty: state.difficulty,
          featured: state.featured,
          timestamp: Date.now(),
        })
      );
    }, 30000); // 30 seconds

    return () => clearTimeout(timeout);
  }, [state, mode, initialSlug]);

  // Load draft on mount
  useEffect(() => {
    if (mode === "edit") return; // Only for create mode

    const draftKey = "wiki-draft-new";
    const savedDraft = localStorage.getItem(draftKey);

    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        const ageMinutes = (Date.now() - draft.timestamp) / 1000 / 60;

        if (ageMinutes < 60 * 24) {
          // Less than 24 hours old
          const restore = window.confirm(
            `Found a draft from ${Math.round(ageMinutes)} minutes ago. Restore it?`
          );
          if (restore) {
            dispatch({ type: "LOAD_DRAFT", draft });
          } else {
            localStorage.removeItem(draftKey);
          }
        } else {
          localStorage.removeItem(draftKey);
        }
      } catch {
        localStorage.removeItem(draftKey);
      }
    }
  }, [mode, dispatch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Non-admins must pick a category from the player-submittable list.
    if (!isAdmin && mode === "create" && !state.category) {
      dispatch({
        type: "SET_ERRORS",
        errors: { category: "Please choose a category for this page." },
      });
      return;
    }

    // Validate. Optional zod fields only accept `undefined`, not `null`, so
    // coerce nullable state into `undefined` before parsing — otherwise the
    // schema rejects the payload and the save silently aborts on fields
    // (templateType / difficulty) that have no inline error UI.
    const validated = createWikiPageSchema.safeParse({
      slug: state.slug,
      title: state.title,
      description: state.description,
      content: state.content,
      category: state.category || undefined,
      tags: state.tags,
      templateType: state.selectedTemplate ?? undefined,
      difficulty: state.difficulty ?? undefined,
      featured: state.featured,
      private: state.private,
    });

    if (!validated.success) {
      const fieldErrors = validated.error.flatten().fieldErrors;
      const errors: Record<string, string> = {};
      const summary: string[] = [];
      Object.entries(fieldErrors).forEach(([key, messages]) => {
        const message = messages?.[0] || "Invalid value";
        errors[key] = message;
        summary.push(`${key}: ${message}`);
      });
      // Always surface a top-level error so validation failures on fields
      // without inline error UI (e.g. templateType) can't make Save look dead.
      if (summary.length > 0) {
        errors._form = `Please fix the following before saving: ${summary.join("; ")}`;
      }
      dispatch({ type: "SET_ERRORS", errors });
      const firstError = Object.values(errors)[0];
      if (firstError) showToast(firstError, "error");
      return;
    }

    dispatch({ type: "SUBMIT_START" });

    try {
      // Non-admin edits go through the author PATCH endpoint; non-admin creates
      // through the player submission endpoint; admins use the admin surface.
      const endpoint = isAdmin ? "/api/admin/wiki" : "/api/wiki";
      const method = mode === "create" ? "POST" : "PATCH";
      const url = mode === "edit" ? `${endpoint}/${initialSlug}` : endpoint;

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated.data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save page");
      }

      const data = await response.json();
      // Different wiki endpoints surface the slug in different places; fall
      // through each shape so we never redirect to /wiki/undefined on success.
      const nextSlug = data.slug ?? data.page?.slug ?? initialSlug ?? state.slug;
      dispatch({ type: "SUBMIT_SUCCESS" });

      // Clear draft on successful submit
      const draftKey = mode === "edit" ? `wiki-draft-edit-${initialSlug}` : "wiki-draft-new";
      localStorage.removeItem(draftKey);

      showToast(
        isAdmin
          ? mode === "create"
            ? "Page published"
            : "Changes published"
          : "Submitted for review",
        "success"
      );
      // Server components on /wiki/[slug] rely on fresh DB reads; without
      // refresh, the redirect can show the cached pre-edit version and make
      // the save look like it didn't take.
      router.refresh();
      router.push(`/wiki/${nextSlug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save page";
      dispatch({ type: "SUBMIT_ERROR", error: message });
      showToast(message, "error");
    }
  };

  const addTag = () => {
    if (tagInput.trim() && !state.tags.includes(tagInput.trim())) {
      dispatch({
        type: "SET_FIELD",
        field: "tags",
        value: [...state.tags, tagInput.trim()],
      });
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    dispatch({
      type: "SET_FIELD",
      field: "tags",
      value: state.tags.filter((t) => t !== tag),
    });
  };

  const handleInsert = (before: string, after: string, placeholder?: string) => {
    if (!contentRef.current) return;

    const textarea = contentRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = state.content.substring(start, end);
    const textToInsert = selectedText || placeholder || "";
    const newContent =
      state.content.substring(0, start) +
      before +
      textToInsert +
      after +
      state.content.substring(end);

    dispatch({ type: "SET_FIELD", field: "content", value: newContent });

    // Reset cursor position after React re-renders
    setTimeout(() => {
      if (contentRef.current) {
        const newCursorPos = start + before.length + textToInsert.length;
        contentRef.current.setSelectionRange(newCursorPos, newCursorPos);
        contentRef.current.focus();
      }
    }, 0);
  };

  const handleInsertImage = (snippet: string) => {
    const textarea = contentRef.current;
    if (!textarea) {
      // Fallback: append at end when editor isn't focused yet.
      dispatch({
        type: "SET_FIELD",
        field: "content",
        value: state.content + (state.content.endsWith("\n") ? "" : "\n") + snippet + "\n",
      });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = state.content.substring(0, start) + snippet + state.content.substring(end);
    dispatch({ type: "SET_FIELD", field: "content", value: newContent });
    setTimeout(() => {
      if (contentRef.current) {
        const pos = start + snippet.length;
        contentRef.current.setSelectionRange(pos, pos);
        contentRef.current.focus();
      }
    }, 0);
  };

  const handleTemplateSelect = (templateId: string, sections: string) => {
    if (templateId) {
      dispatch({ type: "SET_TEMPLATE", template: templateId, sections });
    } else {
      dispatch({ type: "SET_FIELD", field: "selectedTemplate", value: null });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title */}
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-foreground">
          Title
        </label>
        <input
          type="text"
          id="title"
          value={state.title}
          onChange={(e) => dispatch({ type: "SET_FIELD", field: "title", value: e.target.value })}
          className="mt-1 block w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Page title"
        />
        {state.errors.title && <p className="mt-1 text-sm text-red-500">{state.errors.title}</p>}
      </div>

      {/* Slug (auto-generated, read-only) */}
      <div>
        <label htmlFor="slug" className="block text-sm font-medium text-foreground">
          Slug
        </label>
        <input
          type="text"
          id="slug"
          value={state.slug}
          readOnly
          className="mt-1 block w-full rounded-md border border-card-border bg-muted px-3 py-2 text-muted shadow-sm cursor-not-allowed"
          placeholder="Auto-generated from title"
        />
        {state.errors.slug && <p className="mt-1 text-sm text-red-500">{state.errors.slug}</p>}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-foreground">
          Description
        </label>
        <textarea
          id="description"
          value={state.description}
          onChange={(e) =>
            dispatch({ type: "SET_FIELD", field: "description", value: e.target.value })
          }
          rows={2}
          className="mt-1 block w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Brief description of the page"
        />
        {state.errors.description && (
          <p className="mt-1 text-sm text-red-500">{state.errors.description}</p>
        )}
      </div>

      {/* Template Selector */}
      {mode === "create" && (
        <TemplateSelector
          selectedTemplate={state.selectedTemplate}
          onSelectTemplate={handleTemplateSelect}
        />
      )}

      {/* Content */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="content" className="block text-sm font-medium text-foreground">
            Content
          </label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="text-sm text-primary hover:text-primary/80"
          >
            {showPreview ? "Edit" : "Preview"}
          </button>
        </div>
        <div className="mt-1 space-y-2">
          {!showPreview && (
            <WikiEditorToolbar onInsert={handleInsert} onInsertImage={handleInsertImage} />
          )}
          {showPreview ? (
            <div className="min-h-[500px] rounded-md border border-card-border bg-card px-4 py-3">
              <article className="prose prose-sm prose-invert max-w-none">
                <MarkdownContent content={state.content} />
              </article>
            </div>
          ) : (
            <textarea
              ref={contentRef}
              id="content"
              value={state.content}
              onChange={(e) =>
                dispatch({ type: "SET_FIELD", field: "content", value: e.target.value })
              }
              rows={20}
              className="block w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono text-sm"
              placeholder="Write your content here in markdown..."
            />
          )}
        </div>
        {state.errors.content && (
          <p className="mt-1 text-sm text-red-500">{state.errors.content}</p>
        )}
      </div>

      {/* Tags */}
      <div>
        <label htmlFor="tags" className="block text-sm font-medium text-foreground">
          Tags
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            id="tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            className="block flex-1 rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Add a tag"
          />
          <button
            type="button"
            onClick={addTag}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Add
          </button>
        </div>
        {state.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {state.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1 bg-card border border-card-border rounded-full text-sm"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-muted hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {state.errors.tags && <p className="mt-1 text-sm text-red-500">{state.errors.tags}</p>}
      </div>

      {/* Category — required for non-admin submissions */}
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-foreground">
          Category {!isAdmin && <span className="text-red-500">*</span>}
        </label>
        <select
          id="category"
          value={state.category}
          onChange={(e) =>
            dispatch({ type: "SET_FIELD", field: "category", value: e.target.value })
          }
          className="mt-1 block w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select a category…</option>
          {PLAYER_SUBMITTABLE_CATEGORY_IDS.map((id) => {
            const cat = getCategoryById(id);
            return (
              <option key={id} value={id}>
                {cat ? `${cat.icon} ${cat.name}` : id}
              </option>
            );
          })}
        </select>
        {state.errors.category && (
          <p className="mt-1 text-sm text-red-500">{state.errors.category}</p>
        )}
        {state.category && (
          <p className="mt-1 text-xs text-muted">{getCategoryById(state.category)?.description}</p>
        )}
      </div>

      {/* Difficulty */}
      <div>
        <label htmlFor="difficulty" className="block text-sm font-medium text-foreground">
          Difficulty (optional)
        </label>
        <select
          id="difficulty"
          value={state.difficulty || ""}
          onChange={(e) =>
            dispatch({
              type: "SET_FIELD",
              field: "difficulty",
              value: e.target.value || null,
            })
          }
          className="mt-1 block w-full rounded-md border border-card-border bg-card px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">None</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {/* Admin-only toggles */}
      {isAdmin && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="featured"
              checked={state.featured}
              onChange={(e) =>
                dispatch({ type: "SET_FIELD", field: "featured", value: e.target.checked })
              }
              className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
            />
            <label htmlFor="featured" className="text-sm font-medium text-foreground">
              Featured
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="private"
              checked={state.private || false}
              onChange={(e) =>
                dispatch({ type: "SET_FIELD", field: "private", value: e.target.checked })
              }
              className="h-4 w-4 rounded border-card-border text-warning focus:ring-warning"
            />
            <label htmlFor="private" className="text-sm font-medium text-foreground">
              Private
              <span className="ml-1 text-xs text-muted">(admin-only visibility)</span>
            </label>
          </div>
        </div>
      )}

      {/* Form errors */}
      {state.errors._form && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">{state.errors._form}</p>
        </div>
      )}

      {/* Submit button */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 border border-card-border rounded-md text-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state.isSaving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.isSaving ? "Saving..." : mode === "create" ? "Create Page" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
