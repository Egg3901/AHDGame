import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { randomUUID } from "node:crypto";
import path from "path";
import { isSingleplayer } from "@/lib/singleplayer";
import { singleplayerCdnDir } from "@/lib/singleplayerServer";

/**
 * Singleplayer mirror of the art CDN.
 *
 * A singleplayer build bakes `NEXT_PUBLIC_CDN_BASE=/cdn`, so every map JSON
 * and image URL the app produces lands here instead of on
 * cdn.ahousedividedgame.com. The first request for a path fetches it from the
 * real CDN and writes it under the player's data directory; every later
 * request is served from disk. Nothing has to be enumerated up front, and a
 * world that has been seen once keeps rendering with the network gone.
 *
 * Outside singleplayer this route is inert: the deployed app never emits a
 * `/cdn` URL and the handler answers 404 without touching the filesystem.
 */

export const dynamic = "force-dynamic";

const UPSTREAM = "https://cdn.ahousedividedgame.com";
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/** A hung upstream socket must not pin the request handler forever. */
const UPSTREAM_TIMEOUT_MS = 30_000;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Rejects anything that could escape the mirror directory. */
function safeRelativePath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\\")) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return null;
  }
  return segments.join("/");
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!isSingleplayer()) {
    return new NextResponse(null, { status: 404 });
  }

  const { path: segments } = await context.params;
  const relative = safeRelativePath(segments);
  if (!relative) {
    return new NextResponse(null, { status: 400 });
  }

  // The singleplayer CDN directory lives outside the application tree. If
  // Turbopack tries to statically trace this dynamic path it includes the
  // whole repository in the standalone bundle, adding hundreds of megabytes
  // and slowing both packaging and first installation.
  const localFile = path.join(/*turbopackIgnore: true*/ singleplayerCdnDir(), relative);
  const headers = {
    "Content-Type": contentTypeFor(relative),
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  try {
    const cached = await fs.readFile(localFile);
    return new NextResponse(new Uint8Array(cached), { headers });
  } catch {
    // Not mirrored yet; fall through to the CDN.
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${relative}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const declaredLength = Number(upstream.headers.get("content-length"));
  if (declaredLength > MAX_ASSET_BYTES) {
    await upstream.body?.cancel();
    return new NextResponse(null, { status: 502 });
  }

  const reader = upstream.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 502 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ASSET_BYTES) {
        await reader.cancel();
        return new NextResponse(null, { status: 502 });
      }
      chunks.push(value);
    }
  } catch {
    // A timeout can fire after the response headers arrive, while streaming.
    return new NextResponse(null, { status: 502 });
  }
  const body = new Uint8Array(Buffer.concat(chunks));
  // Publish via tmp + rename: a mid-write kill would otherwise leave a
  // truncated file that is then served (and browser-cached immutable) forever.
  const tmpFile = `${localFile}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(tmpFile, body);
    await fs.rename(tmpFile, localFile);
  } catch (error) {
    // A read-only or full disk should not break rendering; serve it anyway.
    await fs.rm(tmpFile, { force: true }).catch(() => {});
    console.warn(`[singleplayer/cdn] could not mirror ${relative}:`, error);
  }
  return new NextResponse(body, { headers });
}
