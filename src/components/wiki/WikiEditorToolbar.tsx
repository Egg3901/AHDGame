"use client";

import { useRef, useState } from "react";

interface WikiEditorToolbarProps {
  onInsert: (before: string, after: string, placeholder?: string) => void;
  /** Called when an image has been uploaded; receives the final markdown snippet. */
  onInsertImage?: (markdown: string) => void;
}

const FORMAT_BUTTONS = [
  { label: "Bold", icon: "B", before: "**", after: "**", placeholder: "bold text" },
  { label: "Italic", icon: "I", before: "_", after: "_", placeholder: "italic text" },
  { label: "Code", icon: "</>", before: "`", after: "`", placeholder: "code" },
  { label: "H1", icon: "H1", before: "# ", after: "", placeholder: "Heading 1" },
  { label: "H2", icon: "H2", before: "## ", after: "", placeholder: "Heading 2" },
  { label: "H3", icon: "H3", before: "### ", after: "", placeholder: "Heading 3" },
  { label: "Link", icon: "🔗", before: "[", after: "](url)", placeholder: "link text" },
  { label: "Bullet List", icon: "•", before: "- ", after: "", placeholder: "list item" },
  { label: "Number List", icon: "1.", before: "1. ", after: "", placeholder: "list item" },
  { label: "Quote", icon: '"', before: "> ", after: "", placeholder: "quote" },
  {
    label: "Table",
    icon: "⊞",
    before: "| Col A | Col B |\n| --- | --- |\n| ",
    after: " |  |\n",
    placeholder: "cell",
  },
  {
    label: "Code Block",
    icon: "{ }",
    before: "```\n",
    after: "\n```",
    placeholder: "code block",
  },
  {
    label: "Wiki Link",
    icon: "[[ ]]",
    before: "[[",
    after: "]]",
    placeholder: "Page Title",
  },
] as const;

export function WikiEditorToolbar({ onInsert, onInsertImage }: WikiEditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset so picking the same file twice re-fires onchange.
    e.target.value = "";
    if (!file || !onInsertImage) return;

    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/wiki-image", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      // Strip characters that would break out of markdown image syntax.
      const safeAlt = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[\[\]()]/g, "")
        .slice(0, 80);
      onInsertImage(`![${safeAlt}](${url})`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 p-2 border border-card-border rounded-md bg-card">
        {FORMAT_BUTTONS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            onClick={() => onInsert(btn.before, btn.after, btn.placeholder)}
            className="px-3 py-1.5 text-sm font-medium border border-card-border rounded hover:bg-muted transition-colors"
            title={btn.label}
            aria-label={btn.label}
          >
            {btn.icon}
          </button>
        ))}
        {onInsertImage && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-sm font-medium border border-card-border rounded hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Upload image"
              aria-label="Upload image"
            >
              {uploading ? "Uploading…" : "🖼 Image"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        )}
      </div>
      {uploadError && <p className="text-xs text-red-500">Image upload failed: {uploadError}</p>}
    </div>
  );
}
