/**
 * Check every changelog entry on disk, from the pre-commit hook.
 *
 * This is the same check CI runs (entryFiles.test.ts), moved forward to the
 * moment the author commits. The CI guard is correct but slow to speak: a bad
 * badge or area value merged to development turns the build red for everybody,
 * and each round trip costs a full CI cycle. That happened three times in one
 * session. Here the author learns in about a second, on their own branch.
 *
 * It is wired into lint-staged under a content/changelog glob, so it only runs
 * on commits that actually touch a changelog entry. Every other commit pays
 * nothing.
 */
import { ENTRY_DIRS, checkEntryDir } from "../../src/lib/changelog/entryFiles";

function main(): void {
  const problems = ENTRY_DIRS.flatMap(({ dir, label, kind }) =>
    checkEntryDir(dir, { kind }).map((p) => ({ ...p, label }))
  );

  if (problems.length === 0) return;

  console.error("Changelog entries have problems:\n");
  for (const { label, file, problem } of problems) {
    console.error(`  ${label}/${file}: ${problem}`);
  }
  console.error('\nRun `npm run changelog:new -- "Title"` to generate a valid entry.');
  process.exit(1);
}

main();
