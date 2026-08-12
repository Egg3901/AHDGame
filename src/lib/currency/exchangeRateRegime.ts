/**
 * B6 — currency regimes and the impossible trinity.
 *
 * The pieces of an exchange-rate regime already existed, but not as a regime.
 * `hardPeg` was an ADMIN field — an operator tool, never a monetary choice a
 * player makes. `interventionPolicy` was a chair-set band. Which regime a
 * country ran was implied by which fields happened to be set, and choosing one
 * cost nothing, because nothing else in the model knew about the choice.
 *
 * ## The trinity is the mechanic
 *
 * A country cannot have all three of:
 *
 *   1. a FIXED exchange rate,
 *   2. FREE capital movement,
 *   3. an INDEPENDENT monetary policy.
 *
 * Pick any two. That is not a flavour note, it is the entire reason an
 * exchange-rate regime is a decision rather than a label — and it is what makes
 * a peg cost something instead of being free stability.
 *
 * So: peg your currency and keep your capital account open, and the policy rate
 * is no longer yours — it is set by whatever defending the peg requires. Want
 * the rate back? Either float, or close the capital account and accept what
 * that does to your economy.
 *
 * Note what is NOT modelled here: the peg does not silently break when it is
 * inconsistent. A regime that quietly stopped working would teach the player
 * nothing. The constraint binds where the player can see it — at the moment
 * they try to change the rate.
 */

export type FxRegime = "float" | "band" | "peg";

/** Which corner of the trinity a configuration gives up. */
export type TrinityGivenUp = "exchangeRateStability" | "capitalMobility" | "monetaryIndependence";

export interface TrinityPosition {
  regime: FxRegime;
  capitalControls: boolean;
  /** True when the chair may still move the policy rate. */
  monetaryIndependence: boolean;
  /** True when the rate is committed (band or peg). */
  exchangeRateStability: boolean;
  capitalMobility: boolean;
  /**
   * Every corner this configuration does NOT hold.
   *
   * Usually one: the trinity says you may hold at most two, and a sensible
   * choice holds exactly two. It can be TWO, though — floating a currency AND
   * closing the capital account gives up both stability and mobility to buy an
   * independence a float already provided. That is a wasteful configuration,
   * not an impossible one, and the model reports it as such rather than
   * pretending the player got a trade they did not.
   */
  givenUp: TrinityGivenUp[];
  /** True when the configuration surrenders more than the trinity requires. */
  wasteful: boolean;
}

/**
 * Resolve which two corners a configuration actually holds.
 *
 * A BAND is a partial commitment and is deliberately treated as fixed for the
 * trinity: a chair who has promised to defend a corridor has promised to spend
 * reserves defending it, and cannot also promise the rate is free. Treating a
 * band as a float would make the band a free option — commit publicly, defend
 * nothing.
 */
export function resolveTrinity(regime: FxRegime, capitalControls: boolean): TrinityPosition {
  const exchangeRateStability = regime !== "float";
  const capitalMobility = !capitalControls;

  // Monetary independence survives unless the country is BOTH committed to a
  // rate AND open to capital flows. That is the only genuinely impossible
  // combination; every other pairing is fine.
  const monetaryIndependence = !(exchangeRateStability && capitalMobility);

  const givenUp: TrinityGivenUp[] = [];
  if (!exchangeRateStability) givenUp.push("exchangeRateStability");
  if (!capitalMobility) givenUp.push("capitalMobility");
  if (!monetaryIndependence) givenUp.push("monetaryIndependence");

  return {
    regime,
    capitalControls,
    monetaryIndependence,
    exchangeRateStability,
    capitalMobility,
    givenUp,
    wasteful: givenUp.length > 1,
  };
}

/**
 * May the chair change the policy rate under this configuration?
 *
 * Returns a refusal string when not, phrased so the player can see the way out
 * rather than just the wall — the two escapes are named because both are real
 * moves they can make this turn.
 */
export function rateChangeRefusal(
  regime: FxRegime,
  capitalControls: boolean
): string | null {
  const trinity = resolveTrinity(regime, capitalControls);
  if (trinity.monetaryIndependence) return null;
  return regime === "peg"
    ? "The currency is pegged and the capital account is open, so the policy rate is set by defending the peg. Float the currency or impose capital controls to take the rate back."
    : "The currency is committed to an intervention band and the capital account is open, so the policy rate is not independent. Cancel the band or impose capital controls to take the rate back.";
}

/**
 * Human-readable summary of what a configuration costs, for the card and the
 * confirmation dialog. Published as a function so the copy and the engine
 * cannot disagree about which corner was surrendered.
 */
export function describeTrinity(position: TrinityPosition): string {
  if (position.wasteful) {
    // Named plainly rather than dressed up. A player in this state has paid
    // for something they were already getting, and should be told so.
    return "The currency floats and the capital account is closed. Controls buy nothing here: a floating currency already leaves the policy rate free.";
  }
  if (!position.monetaryIndependence)
    return "Stable rate and open capital account. The policy rate is not yours.";
  if (!position.capitalMobility)
    return "Stable rate and an independent policy rate. Capital cannot move freely.";
  return "Independent policy rate and open capital account. The currency floats.";
}
