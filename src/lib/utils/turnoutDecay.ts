const DECAY_RATE = 0.02; // 2% per turn
const ZERO_THRESHOLD = 0.01;

/**
 * Apply decay to a turnout modifier.
 * Reduces modifier by 2% per turn, rounds to zero when below threshold.
 *
 * @param modifier - Current modifier value
 * @returns Decayed modifier
 */
export function applyDecay(modifier: number): number {
  const decayed = modifier * (1.0 - DECAY_RATE);

  if (Math.abs(decayed) < ZERO_THRESHOLD) {
    return 0;
  }

  return decayed;
}
