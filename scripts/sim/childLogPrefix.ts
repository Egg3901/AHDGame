/**
 * Run-identity prefixing for concurrent worldsim child processes (#2071).
 *
 * The worker multiplexes up to CONCURRENCY children onto one shared systemd
 * journal. With `stdio: "inherit"` every child's raw stdout/stderr interleaves
 * unprefixed, so identical engine warnings ([BudgetInvariant], [clearing],
 * ...) from simultaneous jobs cannot be attributed to a run. Prefixing at
 * ingestion — one prefix per captured line, applied by the parent as bytes
 * arrive — covers the ENTIRE child lifetime regardless of which helper or
 * engine phase emitted the line, with no child cooperation required.
 */

import { spawn } from "child_process";

/** Stable identity every concurrent child line must carry. */
export interface ChildRunIdentity {
  runId: string;
  seed: string;
  dbName: string;
  slot: number;
  workerInstance: string;
}

export function buildChildLogPrefix(identity: ChildRunIdentity): string {
  return (
    `[sim run=${identity.runId} seed=${identity.seed} ` +
    `db=${identity.dbName} slot=${identity.slot} worker=${identity.workerInstance}]`
  );
}

export function prefixChildLine(prefix: string, line: string): string {
  return `${prefix} ${line}`;
}

export interface SpawnResult {
  code: number | null;
}

/**
 * Spawn a child with piped stdio and prefix every stdout/stderr line with the
 * run identity before forwarding to the parent (journal). Both streams keep
 * their destination (stdout stays stdout, stderr stays stderr); only the
 * prefix is added. Resolves with the exit code; rejects on spawn error.
 *
 * The sink override exists for the concurrency attribution test; the worker
 * passes no sink and lines go to process.stdout/process.stderr.
 */
export function spawnWithPrefixedLogs(
  command: string,
  args: string[],
  identity: ChildRunIdentity,
  sink?: (line: string) => void,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<SpawnResult> {
  const prefix = buildChildLogPrefix(identity);
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", reject);
    const pump = (stream: "stdout" | "stderr") => {
      const source = stream === "stdout" ? child.stdout : child.stderr;
      const target = stream === "stdout" ? process.stdout : process.stderr;
      let carry = "";
      source.setEncoding("utf8");
      source.on("data", (chunk: string) => {
        carry += chunk;
        const parts = carry.split("\n");
        carry = parts.pop() ?? "";
        for (const part of parts) {
          const line = prefixChildLine(prefix, part.replace(/\r$/, ""));
          if (sink) sink(line);
          else target.write(`${line}\n`);
        }
      });
      source.on("end", () => {
        if (carry.length > 0) {
          const line = prefixChildLine(prefix, carry.replace(/\r$/, ""));
          if (sink) sink(line);
          else target.write(`${line}\n`);
          carry = "";
        }
      });
    };
    pump("stdout");
    pump("stderr");
    child.on("close", (code) => resolve({ code }));
  });
}
