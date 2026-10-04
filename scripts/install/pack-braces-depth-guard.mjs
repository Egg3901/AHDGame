/** Rebuild the local security fork from the pinned, corrected upstream source. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "28d440b5dd449dbf1fe6f3506cf94ecca4d02660";
const archiveUrl = `https://codeload.github.com/micromatch/braces/tar.gz/${revision}`;
const archiveHash = "746542c72b9108f70c19147b6afa2ae382469450d2590118d3dd5b97887cc53c";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = mkdtempSync(join(tmpdir(), "ahd-braces-pack-"));
try {
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Unable to download reviewed braces source: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(archive).digest("hex") !== archiveHash)
    throw new Error("The upstream braces archive differs from the reviewed source");
  const archivePath = join(temporary, "upstream.tar.gz");
  writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xzf", archivePath, "-C", temporary]);
  const upstream = join(temporary, `braces-${revision}`);
  const source = join(temporary, "package");
  mkdirSync(join(source, "lib"), { recursive: true });
  for (const file of [
    "index.js",
    "LICENSE",
    "lib/compile.js",
    "lib/constants.js",
    "lib/expand.js",
    "lib/parse.js",
    "lib/stringify.js",
    "lib/utils.js",
  ])
    copyFileSync(join(upstream, file), join(source, file));
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify(
      {
        name: "@lakeside/braces-depth-guard",
        version: "3.0.3-ahd.1",
        private: true,
        description: "Local braces security fork with bounded AST depth for CVE-2026-93687",
        license: "MIT",
        main: "index.js",
        files: ["index.js", "lib", "upstream.json"],
        dependencies: { "fill-range": "^7.1.1" },
        engines: { node: ">=8.3" },
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(
    join(source, "upstream.json"),
    JSON.stringify(
      {
        package: "braces",
        version: "3.0.3",
        revision,
        archiveUrl,
        archiveSha256: archiveHash,
        securityFix: "https://github.com/micromatch/braces/pull/72",
        advisory: "GHSA-vfj7-8cjw-p6xm",
      },
      null,
      2
    ) + "\n"
  );
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: source,
      encoding: "utf8",
    })
  )[0];
  const destination = join(root, "vendor/braces-depth-guard-3.0.3-ahd.1.tgz");
  copyFileSync(join(temporary, packed.filename), destination);
  console.info(`Reviewed braces fork packed: ${packed.integrity}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
