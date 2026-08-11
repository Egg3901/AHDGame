"use client";

import { useState, useRef, useCallback } from "react";

/**
 * Shared upload logic for image upload components.
 *
 * Handles FormData construction, fetch to the endpoint, loading/error
 * state, and input ref management. The calling component provides the
 * visual presentation.
 */
export function useImageUpload(
  endpoint: string,
  opts?: {
    initialUrl?: string | null;
    onSuccess?: (url: string) => void;
    /** Return an error message to block upload; otherwise return undefined. */
    validateFile?: (file: File) => string | undefined;
  }
) {
  const [url, setUrl] = useState(opts?.initialUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const onSuccessRef = useRef(opts?.onSuccess);
  onSuccessRef.current = opts?.onSuccess;
  const validateFileRef = useRef(opts?.validateFile);
  validateFileRef.current = opts?.validateFile;

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validationError = validateFileRef.current?.(file);
      if (validationError) {
        setError(validationError);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      setError("");
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Upload failed");
          return;
        }

        setUrl(data.url);
        onSuccessRef.current?.(data.url);
      } catch {
        setError("Upload failed. Please try again.");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [endpoint]
  );

  const triggerUpload = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return { url, uploading, error, inputRef, handleFileChange, triggerUpload };
}
