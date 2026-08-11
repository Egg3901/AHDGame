"use client";

interface WikiPageFormProps {
  mode: "create" | "edit";
  slug: string;
  title: string;
  description: string;
  content: string;
  featured: boolean;
  slugDisabled?: boolean;
  onSlugChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onFeaturedChange: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
}

export function WikiPageForm({
  mode,
  slug,
  title,
  description,
  content,
  featured,
  slugDisabled,
  onSlugChange,
  onTitleChange,
  onDescriptionChange,
  onContentChange,
  onFeaturedChange,
  onSubmit,
  onCancel,
  saving,
}: WikiPageFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-card-border bg-card p-6 space-y-4"
    >
      <h3 className="font-semibold">{mode === "create" ? "New Wiki Page" : "Edit Wiki Page"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Slug (URL path)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => onSlugChange(e.target.value)}
            placeholder="my-new-page"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
            required
            disabled={slugDisabled}
          />
          {mode === "create" && (
            <p className="mt-1 text-xs text-muted">
              Lowercase, hyphens only. Cannot be changed later.
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Page Title"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
            required
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Short description for search and cards"
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Content (Markdown)</label>
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="# Heading\n\nYour content here..."
          rows={12}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="featured"
          checked={featured}
          onChange={(e) => onFeaturedChange(e.target.checked)}
        />
        <label htmlFor="featured" className="text-sm">
          Featured (show in Start Here)
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
