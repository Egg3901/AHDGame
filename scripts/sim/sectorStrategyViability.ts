import { CORPORATION_TYPES } from "../../src/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "../../src/lib/constants/sectorStrategies";
import { analyzeStrategyViability } from "../../src/lib/market/sectorViability";

const rows = CORPORATION_TYPES.flatMap((sectorType) =>
  SECTOR_STRATEGIES[sectorType].map((strategy) => analyzeStrategyViability(sectorType, strategy))
);

const summary = {
  strategies: rows.length,
  impossibleAtBalance: rows.filter((row) => row.status === "impossible_at_balance").length,
  stressSensitive: rows.filter((row) => row.status === "stress_sensitive").length,
  minimumBalancedOutputRate: Math.min(...rows.map((row) => row.balancedOutputRate)),
  maximumBalancedOutputRate: Math.max(...rows.map((row) => row.balancedOutputRate)),
  maximumBalancedInputShare: Math.max(...rows.map((row) => row.balancedInputShare)),
  minimumBalancedContributionShare: Math.min(...rows.map((row) => row.balancedContributionShare)),
};

console.log(JSON.stringify({ summary, rows }, null, 2));
if (summary.impossibleAtBalance > 0) process.exitCode = 1;
