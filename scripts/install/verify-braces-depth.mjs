/** Verify every installed copy of the reviewed local braces security fork. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hashes = {
  LICENSE: "35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2",
  "lib/compile.js": "b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195",
  "lib/constants.js": "f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c",
  "lib/expand.js": "7ea3e14c2b2b256ef244fd3d83b8fcaa20aa2232b4e6d768c3bb6ab567f66cf5",
  "index.js": "332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4",
  "lib/parse.js": "b1bf766fba6a62035f78ecbda8a5fd94e921aa1c1ec0cdf3f467e9c836abed55",
  "lib/stringify.js": "49dc2d8bafa74f34715a18a845bcb82ce66caaf3bab4cf117998e06b1f9a50a9",
  "lib/utils.js": "b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7",
  "package.json": "fca2b9dcfd61dcd54e7d419e9c149558700183f439a44e1e51c3cc598d16be90",
  "upstream.json": "e0d6edbc6028c3525a3f2b8aa29378dee153d8626391d82e438844d7bc38939b",
};

export function verifyBracesDepth(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== "@lakeside/braces-depth-guard" || manifest.version !== "3.0.3-ahd.1")
    throw new Error("Review or replace the braces security fork for this package identity");
  for (const [file, expected] of Object.entries(hashes)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(packageRoot, file)))
      .digest("hex");
    if (actual !== expected)
      throw new Error(`Braces security fork differs from reviewed package source: ${file}`);
  }
}

export function verifyInstalledBracesDepth(projectRoot) {
  const lock = JSON.parse(readFileSync(join(projectRoot, "package-lock.json"), "utf8"));
  const roots = Object.keys(lock.packages)
    .filter((path) => path === "node_modules/braces" || path.endsWith("/node_modules/braces"))
    .map((path) => join(projectRoot, path))
    // Development tooling is absent from production-only installations.
    .filter((path) => existsSync(join(path, "package.json")));
  for (const root of roots) verifyBracesDepth(root);
  return roots.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const count = verifyInstalledBracesDepth(root);
  console.info(`Braces security fork verified (${count} installed copies)`);
}
