import { rmSync } from "node:fs";
import { join } from "node:path";

// A corrupted persistent Turbopack cache can panic during a Railway build.
// Clear it before Next starts so a failed cache cannot block a live repair.
if (process.env.RAILWAY_ENVIRONMENT_NAME) {
  rmSync(join(process.cwd(), ".next", "cache"), {
    recursive: true,
    force: true,
  });
}
