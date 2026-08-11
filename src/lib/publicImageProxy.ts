import { NextResponse } from "next/server";
import { isUrlSafeToFetch } from "@/lib/security/ssrfGuard";

const IMAGE_PROXY_USER_AGENT =
  "a-house-divided/1.0 (game; https://github.com/Egg3901/a-house-divided)";
const VALID_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const INVALID_IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_IMAGE_VALIDATION_CACHE_ENTRIES = 500;

type ImageValidationCacheEntry = {
  isValid: boolean;
  expiresAt: number;
};

const imageValidationCache = new Map<string, ImageValidationCacheEntry>();

// Content types a misconfigured store/CDN serves for binary blobs whose real
// type is unknown. R2 stores uploads without an explicit ContentType as
// application/octet-stream, so our own image uploads arrive labelled this way.
const GENERIC_BINARY_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)(?:[?#]|$)/i;

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function hasImageExtension(url: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(url);
}

function resolveCandidateUrl(candidateUrl: string, requestUrl: string): string {
  return isAbsoluteHttpUrl(candidateUrl)
    ? candidateUrl
    : new URL(candidateUrl, requestUrl).toString();
}

function getCachedValidation(resolvedUrl: string): boolean | null {
  const cached = imageValidationCache.get(resolvedUrl);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    imageValidationCache.delete(resolvedUrl);
    return null;
  }

  imageValidationCache.delete(resolvedUrl);
  imageValidationCache.set(resolvedUrl, cached);
  return cached.isValid;
}

function setCachedValidation(resolvedUrl: string, isValid: boolean): void {
  imageValidationCache.delete(resolvedUrl);
  imageValidationCache.set(resolvedUrl, {
    isValid,
    expiresAt: Date.now() + (isValid ? VALID_IMAGE_CACHE_TTL_MS : INVALID_IMAGE_CACHE_TTL_MS),
  });
  if (imageValidationCache.size > MAX_IMAGE_VALIDATION_CACHE_ENTRIES) {
    const oldestUrl = imageValidationCache.keys().next().value;
    if (oldestUrl !== undefined) imageValidationCache.delete(oldestUrl);
  }
}

async function isServableImageCandidate(
  resolvedUrl: string,
  revalidateSeconds: number,
  logPrefix: string
): Promise<boolean> {
  const cached = getCachedValidation(resolvedUrl);
  if (cached !== null) {
    return cached;
  }

  try {
    // SSRF guard: never fetch a user-supplied absolute URL that resolves to a
    // private/reserved IP (cloud metadata, RFC1918, loopback). Relative URLs
    // resolve to our own origin and are not user-controlled.
    if (isAbsoluteHttpUrl(resolvedUrl) && !(await isUrlSafeToFetch(resolvedUrl))) {
      console.warn(`[${logPrefix}] Blocked SSRF-unsafe image candidate ${resolvedUrl}`);
      setCachedValidation(resolvedUrl, false);
      return false;
    }

    const response = await fetch(resolvedUrl, {
      next: { revalidate: revalidateSeconds },
      redirect: "error",
      headers: isAbsoluteHttpUrl(resolvedUrl)
        ? {
            "User-Agent": IMAGE_PROXY_USER_AGENT,
          }
        : undefined,
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    // Trust a known image extension when the store reports a generic binary
    // type (or none) — our R2/CDN serves uploaded logos as octet-stream.
    const contentTypeIsGenericBinary =
      contentType === "" || GENERIC_BINARY_CONTENT_TYPES.has(contentType);
    const looksLikeImage =
      contentType.startsWith("image/") ||
      (contentTypeIsGenericBinary && hasImageExtension(resolvedUrl));
    const isValid = response.ok && looksLikeImage;

    await response.body?.cancel().catch(() => {});

    if (!response.ok) {
      console.warn(
        `[${logPrefix}] Skipping non-ok image candidate ${resolvedUrl}: ${response.status}`
      );
    } else if (!isValid) {
      console.warn(
        `[${logPrefix}] Skipping non-image candidate ${resolvedUrl}: ${
          contentType || "missing content-type"
        }`
      );
    }

    setCachedValidation(resolvedUrl, isValid);
    return isValid;
  } catch (err) {
    setCachedValidation(resolvedUrl, false);
    console.warn(`[${logPrefix}] Failed to fetch image candidate ${resolvedUrl}:`, err);
    return false;
  }
}

export async function redirectToFirstAvailableImage(
  candidateUrls: Array<string | null | undefined>,
  requestUrl: string,
  cacheControl: string,
  revalidateSeconds = 3600,
  logPrefix = "ImageProxy"
): Promise<NextResponse | null> {
  for (const candidateUrl of candidateUrls) {
    if (!candidateUrl) continue;

    const resolvedUrl = resolveCandidateUrl(candidateUrl, requestUrl);
    if (await isServableImageCandidate(resolvedUrl, revalidateSeconds, logPrefix)) {
      return redirectToFallbackImage(resolvedUrl, requestUrl, cacheControl);
    }
  }

  return null;
}

export function redirectToFallbackImage(
  fallbackPath: string,
  requestUrl: string,
  cacheControl: string
): NextResponse {
  return NextResponse.redirect(new URL(fallbackPath, requestUrl), {
    status: 302,
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}

export function resetImageValidationCacheForTests(): void {
  imageValidationCache.clear();
}
