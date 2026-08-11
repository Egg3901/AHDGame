import type { ObjectId } from "mongodb";

export interface CodeQualitySnapshot {
  _id: ObjectId;
  timestamp: Date;
  environment: "localhost" | "staging" | "production";
  gitSha: string;
  gitBranch: string;

  overallScore: number;
  mobileScore: number;

  lint: {
    errorCount: number;
    warningCount: number;
    byRule: Record<string, number>;
  };
  typescript: {
    errorCount: number;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    coveragePercent: number;
  };
  format: {
    violationCount: number;
  };
  bundle: {
    buildSuccess: boolean;
    totalSizeBytes: number;
    mobileSizeBytes: number;
    pageSizes: Record<string, number>;
  };
  dependencies: {
    outdatedCount: number;
    vulnerabilities: {
      critical: number;
      high: number;
      moderate: number;
      low: number;
    };
  };
}
