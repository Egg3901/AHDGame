import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// A corrupted persistent Turbopack cache can panic during a Railway build.
// Clear it before Next starts so a failed cache cannot block a live repair.
//
// `.next/cache` is a buildkit cache MOUNT on services with cache mounts
// enabled, so the directory itself cannot be removed (rmSync fails EBUSY).
// Empty its contents instead; and never let a cache sweep fail the build.
if (process.env.RAILWAY_ENVIRONMENT_NAME) {
  const cacheDir = join(process.cwd(), ".next", "cache");
  try {
    for (const entry of readdirSync(cacheDir)) {
      rmSync(join(cacheDir, entry), { recursive: true, force: true });
    }
  } catch {
    // Missing or partially-removed cache is the point of this sweep, not an
    // error worth failing a deploy over.
  }
}
