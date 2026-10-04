import { runResetAndBootstrapCli } from "./resetAndBootstrapCli";

runResetAndBootstrapCli().catch((error) => {
  console.error("Reset and bootstrap failed:", error);
  process.exit(1);
});
