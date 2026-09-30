/**
 * MongoDB 7.6.0 omits getMore maxTimeMS only when a cursor owns timeoutMS.
 * Transaction-only deadlines therefore send an illegal maxTimeMS on ordinary
 * getMore. Preserve driver deadlines, suppress only that server field, and
 * fail installation on unreviewed driver changes rather than silently patching.
 * https://github.com/mongodb/specifications/blob/master/source/client-side-operations-timeout/client-side-operations-timeout.md#non-tailable-cursors
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const originalHash = "5277d65097f6058b0cbf3cfc899361b7156b3e54cfd0232afba2b972de844490";
const original = "            timeoutContext,\n            ...this.options\n";
const replacement =
  "            timeoutContext,\n            ...this.options,\n            // A transaction deadline must never become ordinary getMore.maxTimeMS.\n            omitMaxTimeMS: this.options.omitMaxTimeMS || !(this.options.tailable && this.options.awaitData)\n";

export function patchMongoTransactionCursors(driverRoot) {
  const version = JSON.parse(readFileSync(join(driverRoot, "package.json"), "utf8")).version;
  if (version !== "7.6.0")
    throw new Error(`Review or remove the Mongo cursor compatibility patch for driver ${version}`);
  const path = join(driverRoot, "lib/operations/get_more.js");
  const source = readFileSync(path, "utf8");
  const reverted = source.includes(replacement) ? source.replace(replacement, original) : source;
  if (
    createHash("sha256").update(reverted).digest("hex") !== originalHash ||
    !reverted.includes(original)
  )
    throw new Error("Mongo cursor compatibility patch does not match the reviewed driver source");
  if (source === reverted) writeFileSync(path, source.replace(original, replacement));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  patchMongoTransactionCursors(dirname(require.resolve("mongodb/package.json")));
  console.info("Mongo transaction cursor compatibility patch verified (7.6.0)");
}
