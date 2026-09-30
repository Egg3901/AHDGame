/** Read-only standing election qualification from an existing isolated sandbox. */
import { MongoClient } from "mongodb";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { collectElectionTurnoverReport } from "@/lib/sim/electionTurnover";

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const split = arg.indexOf("=");
      return [arg.slice(2, split), arg.slice(split + 1)];
    })
  );
  const uri = process.env.SIM_MONGODB_URI;
  if (!uri || !args.db?.startsWith("ahd_sim_") || !args.out)
    throw new Error("Require SIM_MONGODB_URI, --db=ahd_sim_... and --out=...");
  const parsed = new URL(uri);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== "27018")
    throw new Error("Only the local isolated sandbox is allowed");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  let commands = 0;
  const client = new MongoClient(uri, { monitorCommands: true });
  client.on("commandStarted", (event) => {
    if (!["hello", "ismaster", "ping", "endSessions", "killCursors"].includes(event.commandName))
      commands++;
    if (
      ![
        "find",
        "aggregate",
        "getMore",
        "hello",
        "ismaster",
        "ping",
        "endSessions",
        "killCursors",
      ].includes(event.commandName)
    )
      throw new Error(`Unexpected non-read command: ${event.commandName}`);
  });
  try {
    await client.connect();
    const report = await collectElectionTurnoverReport(client.db(args.db));
    const output = { reportSourceCommit: sourceCommit, sandbox: args.db, commands, report };
    writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
    console.log(
      JSON.stringify({
        resolvedCycles: report.resolvedCycles,
        families: report.families.length,
        commands,
      })
    );
  } finally {
    await client.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
