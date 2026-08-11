"use client";

import type { Options as Html2CanvasOptions } from "html2canvas";

/**
 * Full-page screenshot for navbar Quick suggest only (html2canvas).
 * The /feedback board compose flow does not call this — upload optional there.
 * — Mobile (phone/tablet UA): skipped with captureFailed=false so the UI does not say "failed".
 * — Desktop: clones are sanitized (cross-origin imgs stripped) so export stays valid.
 */

function isLikelyMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/** Strip third-party images/media from the clone so the canvas stays export-safe. */
function sanitizeCloneForScreenshot(clonedDoc: Document): void {
  const origin = window.location.origin;

  const isSameOriginSrc = (raw: string): boolean => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return true;
    if (raw.startsWith("/") || raw.startsWith("./")) return true;
    try {
      const u = new URL(raw, origin);
      return u.origin === origin;
    } catch {
      return false;
    }
  };

  clonedDoc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    const srcset = img.getAttribute("srcset");
    if (src && !isSameOriginSrc(src)) {
      img.removeAttribute("src");
      img.removeAttribute("srcset");
      img.style.opacity = "0";
    } else if (srcset && !src) {
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (first && !isSameOriginSrc(first)) {
        img.removeAttribute("srcset");
        img.style.opacity = "0";
      }
    }
  });

  clonedDoc.querySelectorAll("source").forEach((el) => el.remove());
  clonedDoc.querySelectorAll("iframe, video, embed, object").forEach((el) => el.remove());
}

async function canvasToExportableDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  let dataUrl: string | null = null;
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      dataUrl = await new Promise<string | null>((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.82
        );
      });
    }
  }

  if (!dataUrl || dataUrl.length < 96) return null;
  return dataUrl;
}

async function captureRoot(
  html2canvas: (
    element: HTMLElement,
    options?: Partial<Html2CanvasOptions>
  ) => Promise<HTMLCanvasElement>,
  root: HTMLElement,
  scale: number,
  timeoutMs: number
): Promise<HTMLCanvasElement> {
  return Promise.race([
    html2canvas(root, {
      logging: false,
      useCORS: true,
      allowTaint: false,
      scale,
      imageTimeout: 12000,
      onclone: (clonedDoc: Document) => {
        sanitizeCloneForScreenshot(clonedDoc);
      },
      ignoreElements: (el: Element) =>
        el.closest("[data-feedback-ignore]") !== null ||
        el.tagName === "IFRAME" ||
        el.tagName === "SCRIPT" ||
        el.tagName === "NOSCRIPT",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("screenshot timeout")), timeoutMs)
    ),
  ]);
}

export async function captureFeedbackScreenshot(): Promise<{
  dataUrl: string | null;
  /** True only when capture was attempted and no image could be produced. */
  captureFailed: boolean;
}> {
  if (typeof window === "undefined") {
    return { dataUrl: null, captureFailed: false };
  }

  if (isLikelyMobileDevice()) {
    return { dataUrl: null, captureFailed: false };
  }

  try {
    const html2canvas = (await import("html2canvas")).default;

    const roots: HTMLElement[] = [];
    const nextRoot = document.getElementById("__next");
    if (nextRoot) roots.push(nextRoot);
    if (!roots.includes(document.body)) roots.push(document.body);

    for (const scale of [1, 0.75]) {
      for (const root of roots) {
        try {
          const canvas = await captureRoot(html2canvas, root, scale, 14000);
          const dataUrl = await canvasToExportableDataUrl(canvas);
          if (dataUrl) {
            return { dataUrl, captureFailed: false };
          }
        } catch {
          /* try next root / scale */
        }
      }
    }

    return { dataUrl: null, captureFailed: true };
  } catch {
    return { dataUrl: null, captureFailed: true };
  }
}
