"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Mirrors the server-side guards on the avatar / profile-header upload routes. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export interface PickedImage {
  /** The chosen file, or null when nothing is selected. */
  file: File | null;
  /** Object URL for previewing `file`, or null. */
  previewUrl: string | null;
  /** Rejection reason for the last attempted pick, or null. */
  error: string | null;
  pick: (file: File | null) => void;
  clear: () => void;
}

/**
 * Holds one locally-chosen image and its preview URL.
 *
 * The creator cannot upload during creation — the avatar and header routes both
 * write onto an existing character document, and the character does not exist
 * until submit. So the file is held here, previewed from an object URL, and
 * uploaded by the caller once creation succeeds. Object URLs are revoked on
 * replace and on unmount so previews do not leak.
 */
export function useImagePick(maxBytes: number): PickedImage {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  const pick = useCallback(
    (next: File | null) => {
      if (!next) {
        release();
        setFile(null);
        setPreviewUrl(null);
        setError(null);
        return;
      }
      if (!ALLOWED_IMAGE_TYPES.includes(next.type)) {
        setError("Use a JPEG, PNG, WebP, or GIF image.");
        return;
      }
      if (next.size > maxBytes) {
        setError(`Image must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        return;
      }
      release();
      const url = URL.createObjectURL(next);
      urlRef.current = url;
      setFile(next);
      setPreviewUrl(url);
      setError(null);
    },
    [maxBytes, release]
  );

  const clear = useCallback(() => pick(null), [pick]);

  return { file, previewUrl, error, pick, clear };
}

/**
 * Upload one already-created character's image. Returns true on success.
 * Failures are non-fatal to creation: the character exists either way and the
 * player can set the image later from their profile.
 */
export async function uploadCharacterImage(
  endpoint: "/api/upload/avatar" | "/api/upload/profile-header",
  file: File
): Promise<boolean> {
  try {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(endpoint, { method: "POST", body });
    return res.ok;
  } catch {
    return false;
  }
}
