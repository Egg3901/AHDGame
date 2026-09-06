/**
 * Move a pre-consolidation changelog entry to an unreleased note.
 *
 * Usage:
 *   npm run changelog:migrate
 *
 * A branch cut before the consolidation carries
 * `content/changelog/dev/<version>-<topic>.md`, which the guard now rejects:
 * that directory holds one post per release, and a per-change entry belongs in
 * `content/changelog/unreleased/` with no version at all.
 *
 * Nine pull requests were open with entries in the old shape when the
 * consolidation landed. This is what each of them runs instead of hand-editing
 * frontmatter and working out the new rule from a failure message.
 */
import fs from "fs";
import path from "path";
import { DEV_POSTS_DIR, UNRELEASED_DIR } from "../../src/lib/changelog/paths";
import { parseVersionStem } from "../../src/lib/changelog/entryFiles";

/** `1.4.64-crisis-gdp-rate-routing` -> `crisis-gdp-rate-routing`. */
function topicOf(stem: string): string | null {
  const match = stem.match(/^\d+\.\d+\.\d+-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  return match ? match[1] : null;
}

function main(): void {
  if (!fs.existsSync(DEV_POSTS_DIR)) return;

  const stale = fs
    .readdirSync(DEV_POSTS_DIR)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => !parseVersionStem(name.slice(0, -3)));

  if (stale.length === 0) {
    console.log("Nothing to migrate: every dev entry is already named for its release.");
    return;
  }

  fs.mkdirSync(UNRELEASED_DIR, { recursive: true });
  let failed = false;

  for (const name of stale) {
    const stem = name.slice(0, -3);
    const topic = topicOf(stem);
    if (!topic) {
      console.error(
        `${name}: cannot read a topic out of this name. Rename it to ` +
          "content/changelog/unreleased/<topic>.md by hand."
      );
      failed = true;
      continue;
    }

    const target = path.join(UNRELEASED_DIR, `${topic}.md`);
    if (fs.existsSync(target)) {
      console.error(
        `${name}: content/changelog/unreleased/${topic}.md already exists. ` +
          "Merge the two by hand, or pick another topic."
      );
      failed = true;
      continue;
    }

    // The version is the whole point of the move: a note does not have one.
    const raw = fs.readFileSync(path.join(DEV_POSTS_DIR, name), "utf-8");
    const migrated = raw.replace(/^version:.*\n/m, "");
    fs.writeFileSync(target, migrated, "utf-8");
    fs.unlinkSync(path.join(DEV_POSTS_DIR, name));
    console.log(`${name} -> content/changelog/unreleased/${topic}.md`);
  }

  if (failed) process.exit(1);
  console.log("");
  console.log("Commit the move. The release that carries it assigns the version.");
}

main();
