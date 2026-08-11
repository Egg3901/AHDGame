import { NextResponse } from "next/server";

// GET /api/uploads/[...path] — Serves locally stored upload files in development (production uses Vercel Blob URLs directly).
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const relativePath = segments.join("/");

  // Basic path traversal protection
  if (relativePath.includes("..") || relativePath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const fs = await import("fs/promises");
  const pathModule = await import("path");

  const filePath = pathModule.join(process.cwd(), "uploads", relativePath);

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = await fs.readFile(filePath);

    // Determine content type from extension
    const ext = pathModule.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
    };
    const contentType = mimeTypes[ext] ?? "application/octet-stream";

    // Stored SVGs can contain scripts. Force download and sandbox them so they
    // can never execute as a top-level document; <img> rendering still works
    // (it ignores Content-Disposition and never runs scripts inside an SVG).
    const headers: Record<string, string> =
      ext === ".svg"
        ? {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable, no-transform",
            "Content-Disposition": "attachment",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "X-Content-Type-Options": "nosniff",
          }
        : {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable, no-transform",
          };

    return new NextResponse(buffer, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
