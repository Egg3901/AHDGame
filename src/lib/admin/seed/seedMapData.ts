export async function seedCountyMapData(log: (msg: string) => void) {
  const fs = await import("fs");
  const path = await import("path");

  // Map data is pre-built and committed to the repo (src/data/counties/, src/data/congressional-districts/).
  // Check if it already exists before attempting to regenerate — regeneration requires
  // npx tsx which is unavailable in serverless environments (Vercel).
  const countiesDir = path.join(process.cwd(), "src", "data", "counties");
  const districtsDir = path.join(process.cwd(), "src", "data", "congressional-districts");

  const countiesExist = fs.existsSync(countiesDir) && fs.readdirSync(countiesDir).length > 0;
  const districtsExist = fs.existsSync(districtsDir) && fs.readdirSync(districtsDir).length > 0;

  if (countiesExist && districtsExist) {
    const countyCount = fs.readdirSync(countiesDir).filter((f) => f.endsWith(".json")).length;
    const districtCount = fs.readdirSync(districtsDir).filter((f) => f.endsWith(".json")).length;
    log(
      `County/CD map data already exists (${countyCount} county files, ${districtCount} district files) — skipping rebuild`
    );
    return;
  }

  // Only attempt rebuild in environments where npx is available (local dev)
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    log("Building county and CD map data...");
    const { stderr } = await execAsync("npx tsx scripts/prepare-map-data.ts", {
      timeout: 120000,
      cwd: process.cwd(),
    });
    log("County/CD map data built successfully");
    if (stderr) log(`Build warnings: ${stderr}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log(`Failed to build map data: ${message}`);
  }
}
