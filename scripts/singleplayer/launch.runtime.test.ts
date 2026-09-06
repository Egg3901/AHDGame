/**
 * Behavioural tests for the singleplayer launcher's startup phases.
 *
 * The launcher is a dependency-free script copied next to the standalone
 * server, so it is imported here as a library (AHD_LAUNCH_LIBRARY=1 keeps
 * main() from running) and driven against tiny local HTTP servers that stand
 * in for the game in each state a player has actually seen: answering,
 * listening but silent, erroring, and not in singleplayer mode at all.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

process.env.AHD_LAUNCH_LIBRARY = "1";
type Launcher = typeof import("./launch.mjs");
let launcher: Launcher;
beforeAll(async () => {
  launcher = (await import("./launch.mjs")) as Launcher;
});

const servers: Array<Server | TcpServer> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve(null))))
  );
});

type Handler = (url: string, count: number) => { status: number; body?: string } | "hang";

async function fakeGame(handler: Handler): Promise<string> {
  const counts = new Map<string, number>();
  const server = createHttpServer((req, res) => {
    const count = (counts.get(req.url ?? "") ?? 0) + 1;
    counts.set(req.url ?? "", count);
    const answer = handler(req.url ?? "", count);
    if (answer === "hang") return;
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body ?? "{}");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const quiet = { log: () => {}, sleepMs: 10, probeTimeoutMs: 300 };

describe("waitForGame", () => {
  it("reports each phase's elapsed time once health and status both answer", async () => {
    const base = await fakeGame((url, count) => {
      if (url === "/api/health") return count < 3 ? "hang" : { status: 200 };
      if (url === "/api/singleplayer/status") return { status: 200, body: '{"hasWorld":false}' };
      return { status: 404 };
    });
    const timings = await launcher.waitForGame(base, 10_000, quiet);
    expect(Object.keys(timings)).toEqual(["code", "account"]);
    expect(timings.code).toBeGreaterThanOrEqual(2 * quiet.probeTimeoutMs);
    expect(launcher.formatTimings(timings)).toMatch(/^code \d+\.\ds, account \d+\.\ds$/);
  });

  it("names the code phase when the server listens but never answers", async () => {
    const base = await fakeGame(() => "hang");
    const error = await launcher.waitForGame(base, 1_000, quiet).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(launcher.StartupError);
    expect((error as InstanceType<Launcher["StartupError"]>).phase).toBe("code");
    expect(String((error as Error).message)).toMatch(/no answer within 1s/);
  });

  it("surfaces the server's own error instead of hiding it behind a timeout", async () => {
    const seen: string[] = [];
    const base = await fakeGame((url) =>
      url === "/api/health"
        ? { status: 200 }
        : { status: 500, body: '{"error":{"message":"MONGODB_URI is not set"}}' }
    );
    const error = await launcher
      .waitForGame(base, 800, { ...quiet, log: (line: string) => seen.push(line) })
      .catch((e: unknown) => e);
    expect((error as InstanceType<Launcher["StartupError"]>).phase).toBe("account");
    expect(seen).toContain("the game reported: HTTP 500: MONGODB_URI is not set");
    const report = launcher.formatStartupFailure(error, {
      appTail: ["server line 1"],
      mongoLogTail: ["mongo line 1"],
    });
    expect(report).toContain("startup failed while connecting to the local database");
    expect(report).toContain("last answer from the game: HTTP 500: MONGODB_URI is not set");
    expect(report).toContain("    server line 1");
    expect(report).toContain("    mongo line 1");
  });

  it("stops at once when the server is not in singleplayer mode", async () => {
    const started = Date.now();
    const base = await fakeGame((url) =>
      url === "/api/health" ? { status: 200 } : { status: 404, body: "" }
    );
    const error = await launcher.waitForGame(base, 60_000, quiet).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/not running in singleplayer mode/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops at once when the server refuses loopback", async () => {
    const base = await fakeGame((url) =>
      url === "/api/health"
        ? { status: 200 }
        : { status: 403, body: '{"error":"Singleplayer routes only answer on loopback"}' }
    );
    const error = await launcher.waitForGame(base, 60_000, quiet).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/403.*only answer on loopback/);
  });

  it("announces the phase once and stays quiet between progress lines", async () => {
    const seen: string[] = [];
    const base = await fakeGame(() => "hang");
    await launcher
      .waitForAnswer(`${base}/api/health`, "code", 700, {
        ...quiet,
        probeTimeoutMs: 100,
        log: (line: string) => seen.push(line),
      })
      .catch(() => {});
    // The phase announces itself once; progress lines start at 5s, so a
    // sub-second wait must not chatter.
    expect(seen).toEqual(["loading the game's code"]);
  });
});

describe("OutputTail", () => {
  it("keeps the last lines across chunk boundaries and drops the oldest", () => {
    const tail = new launcher.OutputTail(3);
    tail.push("one\ntw");
    tail.push("o\nthree\r\nfour\nfi");
    expect(tail.snapshot()).toEqual(["three", "four", "fi"]);
  });
});

describe("explainMongoExit", () => {
  it("translates the exit codes a player can act on", () => {
    expect(launcher.explainMongoExit(48)).toMatch(/another program is using it/);
    expect(launcher.explainMongoExit(62)).toMatch(/different MongoDB version/);
    expect(launcher.explainMongoExit(3221225781, { win: true, mongoDir: "C:\\m" })).toMatch(
      /vc_redist\.x64\.exe/
    );
    expect(launcher.explainMongoExit(0)).toBeNull();
  });

  it("only re-downloads for a binary that cannot run, never for data or port errors", () => {
    expect(launcher.mongoBinaryLooksBroken(undefined, "ENOENT")).toBe(true);
    expect(launcher.mongoBinaryLooksBroken(127, undefined)).toBe(true);
    expect(launcher.mongoBinaryLooksBroken(48, undefined)).toBe(false);
    expect(launcher.mongoBinaryLooksBroken(62, undefined)).toBe(false);
  });
});

describe("tailOfFile", () => {
  it("reads only the end of a large log", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ahd-tail-"));
    const file = path.join(dir, "mongod.log");
    writeFileSync(file, Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join("\n"));
    expect(launcher.tailOfFile(file, 2)).toEqual(["line 19998", "line 19999"]);
    expect(launcher.tailOfFile(path.join(dir, "missing.log"))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * The whole launcher process against a stub server that listens but never
 * answers: the shape of the Windows first-start freeze. It must exit non-zero
 * within its deadline, name the phase, and include the stub's own output,
 * which proves the child's stdout is captured continuously.
 */
describe("launcher process on a silent server", () => {
  it("fails with a named phase and the captured server output instead of hanging", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ahd-launch-"));
    const stub = path.join(dir, "silent-server.js");
    writeFileSync(
      stub,
      [
        'const http = require("node:http");',
        'console.log("stub game server booting");',
        "http.createServer(() => {}).listen(Number(process.env.PORT), process.env.HOSTNAME, () => {",
        '  console.error("stub game server listening but silent");',
        "});",
      ].join("\n")
    );
    // A listening TCP port stands in for MongoDB so no database is started.
    const mongoStandIn = createTcpServer(() => {});
    servers.push(mongoStandIn);
    await new Promise<void>((resolve) => mongoStandIn.listen(0, "127.0.0.1", resolve));
    const mongoAddress = mongoStandIn.address();
    const mongoPort = typeof mongoAddress === "object" && mongoAddress ? mongoAddress.port : 0;
    const appPort = await new Promise<number>((resolve) => {
      const probe = createTcpServer();
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });

    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/singleplayer/launch.mjs"),
        "--home",
        path.join(dir, "home"),
        "--port",
        String(appPort),
        "--mongo-port",
        String(mongoPort),
        "--no-browser",
      ],
      {
        env: {
          ...process.env,
          AHD_LAUNCH_LIBRARY: "",
          SINGLEPLAYER_SERVER_JS: stub,
          SINGLEPLAYER_READY_TIMEOUT_MS: "1500",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });

    expect(code).toBe(1);
    expect(output).toContain("[ahd] loading the game's code");
    expect(output).toContain("startup failed while loading the game's code: no answer within");
    expect(output).toContain("stub game server booting");
    expect(output).toContain("stub game server listening but silent");
    expect(output).toContain("[ahd] shutting down");
  }, 30_000);
});

/**
 * The control channel: a host writes "shutdown" on stdin and the launcher
 * must exit 0 after stopping what it started. Here nothing was started (the
 * database port is "already in use" and the server is a stub), so this pins
 * the ordering and the exit code; the packaged smoke covers the database's
 * shutdown command against a real mongod.
 */
describe("launcher process shutdown over the control channel", () => {
  it("exits 0 once readiness was announced and shutdown is requested", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ahd-launch-stop-"));
    const stub = path.join(dir, "answering-server.js");
    writeFileSync(
      stub,
      [
        'const http = require("node:http");',
        "http",
        "  .createServer((req, res) => {",
        '    res.setHeader("content-type", "application/json");',
        '    if (req.method === "POST") console.log(`stub got ${req.url}`);',
        '    res.end(req.url === "/api/singleplayer/status" ? \'{"hasWorld":false}\' : \'{"status":"ok"}\');',
        "  })",
        "  .listen(Number(process.env.PORT), process.env.HOSTNAME);",
      ].join("\n")
    );
    const mongoStandIn = createTcpServer(() => {});
    servers.push(mongoStandIn);
    await new Promise<void>((resolve) => mongoStandIn.listen(0, "127.0.0.1", resolve));
    const mongoAddress = mongoStandIn.address();
    const mongoPort = typeof mongoAddress === "object" && mongoAddress ? mongoAddress.port : 0;
    const appPort = await new Promise<number>((resolve) => {
      const probe = createTcpServer();
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/singleplayer/launch.mjs"),
        "--home",
        path.join(dir, "home"),
        "--port",
        String(appPort),
        "--mongo-port",
        String(mongoPort),
        "--no-browser",
      ],
      {
        env: { ...process.env, AHD_LAUNCH_LIBRARY: "", SINGLEPLAYER_SERVER_JS: stub },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let output = "";
    const exit = new Promise<number | null>((resolve) => child.once("exit", resolve));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`never ready:\n${output}`)), 20_000);
      const consume = (chunk: Buffer) => {
        output += chunk;
        if (output.includes(`ready at http://127.0.0.1:${appPort}`)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
    });
    child.stdin.write("shutdown\n");
    const code = await exit;
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(output).toContain("[ahd] shutting down");
    expect(output).toMatch(/startup took .*account \d/);
  }, 40_000);
});
