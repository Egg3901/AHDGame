import { describe, expect, it, vi } from "vitest";
import { recoverCredentialImport } from "./credentialImportRecovery";

function fixture(state: "COMMITTED" | "ABORTED" | null) {
  const oldAttempt = { attemptId: "old", binding: { version: 2 } };
  const newAttempt = { attemptId: "new", binding: { version: 2 } };
  const dependencies = {
    loadUnresolvedAttempt: vi.fn(async () => oldAttempt),
    loadReceipt: vi.fn(async () => (state ? { state } : null)),
    abortAttempt: vi.fn(async () => undefined),
    createAttempt: vi.fn(async () => newAttempt),
    dispatchAttempt: vi.fn(async () => undefined),
    reconcileAttempt: vi.fn(async () => undefined),
  };
  return { dependencies, oldAttempt, newAttempt };
}

describe("credential import recovery", () => {
  it("records an authenticated abort and imports with a fresh attempt", async () => {
    const f = fixture("ABORTED");
    await recoverCredentialImport(f.dependencies);
    expect(f.dependencies.abortAttempt).toHaveBeenCalledWith("old");
    expect(f.dependencies.createAttempt).toHaveBeenCalledOnce();
    expect(f.dependencies.dispatchAttempt).toHaveBeenCalledWith(f.newAttempt);
    expect(f.dependencies.reconcileAttempt).toHaveBeenCalledWith("new");
  });

  it("reconciles a committed attempt without dispatching again", async () => {
    const f = fixture("COMMITTED");
    await recoverCredentialImport(f.dependencies);
    expect(f.dependencies.reconcileAttempt).toHaveBeenCalledWith("old");
    expect(f.dependencies.dispatchAttempt).not.toHaveBeenCalled();
    expect(f.dependencies.createAttempt).not.toHaveBeenCalled();
  });

  it("replays the exact unresolved attempt when no terminal receipt exists", async () => {
    const f = fixture(null);
    await recoverCredentialImport(f.dependencies);
    expect(f.dependencies.dispatchAttempt).toHaveBeenCalledWith(f.oldAttempt);
    expect(f.dependencies.reconcileAttempt).toHaveBeenCalledWith("old");
    expect(f.dependencies.createAttempt).not.toHaveBeenCalled();
  });
});
