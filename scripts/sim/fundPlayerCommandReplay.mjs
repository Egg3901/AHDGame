/** Run the real fund routes with explicitly synthetic auth and isolated native Mongo. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (key) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const target = arg("target"),
  out = arg("out");
assert(target && /^ahd_sim_fund_commands_[a-z0-9_]+$/.test(target) && out);
assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
const temporary = mkdtempSync(join(tmpdir(), "fund-command-proof-"));
try {
  const outfile = join(temporary, "fixture.cjs");
  await build({
    entryPoints: ["scripts/sim/fundPlayerCommandFixture.mjs"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    tsconfig: "tsconfig.json",
    plugins: [
      {
        name: "synthetic-fixture-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/(auth|mongodb|api\/rateLimit)$/ }, (args) => ({
            path: args.path,
            namespace: "fund-fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fund-fixture" }, (args) => {
            const original = resolve("src", args.path.slice(2)) + ".ts";
            const functions =
              args.path === "@/lib/auth"
                ? `export async function getAuthUserWithCharacter() { const character = await globalThis.fundCommandDb.collection('characters').findOne({_id:globalThis.fundCommandActor}); return {userId:character._id.toHexString(),username:'synthetic-investor',character}; }`
                : args.path === "@/lib/mongodb"
                  ? `export async function getDb(){return globalThis.fundCommandDb;} export async function getMongoClient(){return globalThis.fundCommandClient;}`
                  : `export function checkRateLimit(){return {ok:true};}`;
            return {
              contents: `export * from ${JSON.stringify(original)};\n${functions}`,
              loader: "ts",
              resolveDir: process.cwd(),
            };
          });
        },
      },
    ],
  });
  const child = spawnSync(process.execPath, [outfile, target, out], {
    stdio: "inherit",
    timeout: 90000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      NODE_PATH: resolve("node_modules"),
      MONGODB_URI: "mongodb://127.0.0.1:27018/",
      MONGO_URL: "mongodb://127.0.0.1:27018/",
      MONGODB_DB: target,
      MONGO_DB_NAME: target,
    },
  });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, "Native fund fixture failed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
