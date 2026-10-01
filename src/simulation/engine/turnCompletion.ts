export interface TurnCompletionStatus {
  success: true;
  warningCount: number;
}

/**
 * A turn that reaches the commit path completed successfully. Warnings are
 * advisory diagnostics and remain visible without turning completion into a
 * failure. Exceptions and rejected locks return from separate failure paths.
 */
export function completedTurnStatus(warnings: readonly string[]): TurnCompletionStatus {
  return {
    success: true,
    warningCount: warnings.length,
  };
}
