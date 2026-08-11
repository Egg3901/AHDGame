"use client";

import { useRef, useState } from "react";

interface Props {
  countryCode: string;
  positionId: string;
  onUploaded: () => void;
}

interface UploadProgress {
  loaded: number;
  total: number;
}

function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (p: UploadProgress) => void
): Promise<{ ok: boolean; status: number; body: { url?: string; error?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    xhr.upload.addEventListener("progress", (evt) => {
      if (evt.lengthComputable) {
        onProgress({ loaded: evt.loaded, total: evt.total });
      }
    });

    xhr.addEventListener("load", () => {
      let body: { url?: string; error?: string } = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = { error: "Malformed response" };
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.send(formData);
  });
}

export function CabinetBannerUploader({ countryCode, positionId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setProgress({ loaded: 0, total: file.size });
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadWithProgress(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/banner`,
        formData,
        setProgress
      );
      if (!result.ok) {
        setError(result.body.error ?? "Failed to upload banner");
      } else {
        onUploaded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setUploading(false);
      setProgress(null);
      e.target.value = "";
    }
  }

  const pct =
    progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null;

  return (
    // Absolute only from `sm` up. The masthead row it anchors to is a stacked
    // column on mobile, so an absolutely-positioned button leaves the flow and
    // lands on whatever follows -- reported as the banner control sitting in the
    // tab bar. In the flow it simply takes its place under the identity block.
    <div className="z-10 flex flex-col items-end gap-1 sm:absolute sm:top-4 sm:right-6">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 rounded-lg border border-white/30 bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/60 disabled:opacity-50"
        aria-label="Upload office banner"
      >
        <svg
          className="h-3.5 w-3.5"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path d="M5.5 13.5 8 11l1.5 1.5L13 9l3 3v3.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.5Z" />
          <path d="M4 4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4Zm0 2h12v8H4V6Z" />
        </svg>
        {uploading ? (pct !== null ? `Uploading… ${pct}%` : "Uploading…") : "Change banner"}
      </button>
      {uploading && pct !== null && (
        <div
          className="h-1 w-32 overflow-hidden rounded-full bg-white/20"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-white/80 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        disabled={uploading}
        onChange={handleFileChange}
      />
      {error && (
        <span
          className="rounded-md bg-red-900/70 px-2 py-1 text-xs text-red-100 backdrop-blur-sm"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
