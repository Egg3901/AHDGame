type ImportAttempt = Readonly<{
  attemptId: string;
  binding: Record<string, unknown>;
}>;

type ImportReceipt = Readonly<{ state: "COMMITTED" | "ABORTED" }> | null;

type RecoveryDependencies = Readonly<{
  loadUnresolvedAttempt: () => Promise<ImportAttempt | null>;
  loadReceipt: (binding: Record<string, unknown>) => Promise<ImportReceipt>;
  abortAttempt: (attemptId: string) => Promise<void>;
  createAttempt: () => Promise<ImportAttempt>;
  dispatchAttempt: (attempt: ImportAttempt) => Promise<void>;
  reconcileAttempt: (attemptId: string) => Promise<void>;
}>;

export async function recoverCredentialImport(dependencies: RecoveryDependencies): Promise<void> {
  let attempt = await dependencies.loadUnresolvedAttempt();
  if (attempt) {
    const receipt = await dependencies.loadReceipt(attempt.binding);
    if (receipt?.state === "ABORTED") {
      await dependencies.abortAttempt(attempt.attemptId);
      attempt = null;
    } else if (receipt?.state === "COMMITTED") {
      await dependencies.reconcileAttempt(attempt.attemptId);
      return;
    }
  }
  attempt ??= await dependencies.createAttempt();
  await dependencies.dispatchAttempt(attempt);
  await dependencies.reconcileAttempt(attempt.attemptId);
}
