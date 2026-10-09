/**
 * Read projection that leaves out the money-move settlement history.
 *
 * Every document a money move credits or debits keeps up to SETTLED_KEYS_CAP
 * settlement stamps in `settledKeys`. Only the settlement protocol reads them,
 * with its own projection. On corporations they are about four fifths of the
 * document, so a turn read that loads whole corporations for anything else
 * should exclude them.
 */
export const SETTLEMENT_HISTORY_EXCLUDED = { settledKeys: 0 } as const;
