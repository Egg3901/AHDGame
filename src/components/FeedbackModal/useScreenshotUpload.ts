"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { dataUrlToBlob } from "@/lib/feedback/dataUrlToBlob";

interface UseScreenshotUploadProps {
  isOpen: boolean;
  initialScreenshotDataUrl?: string | null;
  uploadEndpoint?: "/api/suggestions/screenshot" | "/api/feedback/screenshot";
}

export function useScreenshotUpload({
  isOpen,
  initialScreenshotDataUrl,
  uploadEndpoint = "/api/suggestions/screenshot",
}: UseScreenshotUploadProps) {
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [screenshotUploading, setScreenshotUploading] = useState(false);
  const [screenshotUploadedUrl, setScreenshotUploadedUrl] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && initialScreenshotDataUrl) {
      setScreenshotDataUrl(initialScreenshotDataUrl);
      setScreenshotUploadedUrl(null);
      setIncludeScreenshot(true);
    }
    if (!isOpen) {
      setScreenshotDataUrl(null);
      setScreenshotUploadedUrl(null);
      setScreenshotError(null);
      setIncludeScreenshot(true);
    }
  }, [isOpen, initialScreenshotDataUrl]);

  const uploadScreenshot = useCallback(
    async (dataUrl: string): Promise<string | null> => {
      setScreenshotUploading(true);
      setScreenshotError(null);
      try {
        const blob = dataUrlToBlob(dataUrl);
        if (!blob) {
          setScreenshotError(
            "Could not read screenshot data. Try uploading an image file instead."
          );
          return null;
        }
        const form = new FormData();
        const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        form.append("file", blob, `screenshot.${ext}`);
        const uploadRes = await fetch(uploadEndpoint, { method: "POST", body: form });
        const data = await uploadRes.json();
        if (!uploadRes.ok) {
          setScreenshotError(data.error ?? "Screenshot upload failed");
          return null;
        }
        return data.url as string;
      } catch {
        setScreenshotError("Screenshot upload failed");
        return null;
      } finally {
        setScreenshotUploading(false);
      }
    },
    [uploadEndpoint]
  );

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setScreenshotError("Only PNG, JPEG, or WebP images are allowed.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setScreenshotError("Image must be under 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setScreenshotDataUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
    setScreenshotUploadedUrl(null);
    setScreenshotError(null);
    setIncludeScreenshot(true);
  }, []);

  const removeScreenshot = useCallback(() => {
    setScreenshotDataUrl(null);
    setScreenshotUploadedUrl(null);
    setScreenshotError(null);
    setIncludeScreenshot(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const reset = useCallback(() => {
    setScreenshotDataUrl(null);
    setScreenshotUploadedUrl(null);
    setScreenshotError(null);
    setIncludeScreenshot(true);
  }, []);

  return {
    screenshotDataUrl,
    setScreenshotDataUrl,
    screenshotUploadedUrl,
    setScreenshotUploadedUrl,
    screenshotUploading,
    screenshotError,
    includeScreenshot,
    setIncludeScreenshot,
    fileInputRef,
    uploadScreenshot,
    handleFileChange,
    removeScreenshot,
    reset,
  };
}
