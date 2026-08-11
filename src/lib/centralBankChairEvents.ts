/**
 * Discord game-event webhooks for central bank chair nomination / selection.
 * Non-fatal — callers should not await in critical paths beyond fire-and-forget.
 */
import { sendMultiCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getBankId, getConfiguredSharedBankMemberCountries } from "@/lib/centralBank/helpers";

function bankLabels(countryId: CountryId) {
  const c = COUNTRY_CONFIGS[countryId];
  return {
    name: c.centralBank.name,
    abbrev: c.centralBank.abbreviation,
    chairTitle: c.centralBank.chairTitle,
    countryName: c.name,
  };
}

// Chair events for shared central banks (e.g. ECB → DE + IE) must reach every member
// country's webhook, not just whichever member happens to come first in COUNTRY_ORDER.
// For single-country banks this degenerates to [countryId] and behaves like
// sendCountryGameEvent.
function chairEventRecipients(countryId: CountryId): CountryId[] {
  const members = getConfiguredSharedBankMemberCountries(getBankId(countryId));
  return members.length > 0 ? members : [countryId];
}

/** Player resigned as seated chair (mid-term vacancy). */
export async function notifyCbChairResignedDiscord(
  countryId: CountryId,
  chairName: string
): Promise<void> {
  const { abbrev, chairTitle } = bankLabels(countryId);
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: ${chairTitle} resigned`,
    description: `**${chairName}** resigned as ${chairTitle}. A successor will be proposed through the usual selection process.`,
    color: DISCORD_COLORS.govCollapsed,
  });
}

/**
 * Admin locked chair-only CB controls — narrative IMF interim supervision (matches `chairControlsLocked`).
 */
export async function notifyImfMonetarySupervisionDiscord(countryId: CountryId): Promise<void> {
  const { abbrev, name: centralBankName, countryName } = bankLabels(countryId);
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: IMF interim monetary supervision`,
    description:
      `The IMF has assumed interim oversight of **${countryName}'s** monetary policy through the **${centralBankName}** until the economic crisis is stabilized and sovereign debt service can be credibly assured. ` +
      `The chair's independent operational controls are suspended for the duration of this arrangement.`,
    color: DISCORD_COLORS.govCollapsed,
  });
}

/** Admin unlocked chair controls — IMF supervision lifted. */
export async function notifyImfMonetarySupervisionLiftedDiscord(
  countryId: CountryId
): Promise<void> {
  const { abbrev, name: centralBankName, countryName } = bankLabels(countryId);
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: IMF supervision lifted`,
    description: `The IMF has ended interim monetary supervision of **${countryName}**. The **${centralBankName}** chair again holds full operational authority under normal statutes.`,
    color: DISCORD_COLORS.leadership,
  });
}

/** Executive nominates a candidate during the nomination window */
export async function notifyCbExecutiveNominationDiscord(
  countryId: CountryId,
  nomineeName: string,
  nominatedByName: string
): Promise<void> {
  const { abbrev, chairTitle } = bankLabels(countryId);
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: ${chairTitle} nomination`,
    description: `${nominatedByName} nominated **${nomineeName}** for ${chairTitle}.`,
    color: DISCORD_COLORS.leadership,
  });
}

/** Chair selection algorithm chose a player; awaiting accept / decline */
export async function notifyCbChairPendingDiscord(
  countryId: CountryId,
  nomineeName: string,
  pool: "political" | "economic"
): Promise<void> {
  const { abbrev, chairTitle, name } = bankLabels(countryId);
  const poolLabel = pool === "political" ? "executive nominations" : "market candidates";
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: ${chairTitle} selected`,
    description: `**${nomineeName}** was chosen from the ${poolLabel} pool to lead the ${name} and must accept the appointment.`,
    color: DISCORD_COLORS.leadership,
  });
}

export async function notifyCbChairAcceptedDiscord(
  countryId: CountryId,
  chairName: string
): Promise<void> {
  const { abbrev, chairTitle, name } = bankLabels(countryId);
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: ${chairTitle} confirmed`,
    description: `**${chairName}** accepted and is now ${chairTitle} of the ${name}.`,
    color: DISCORD_COLORS.billEnacted,
  });
}

export async function notifyCbChairDeclinedDiscord(
  countryId: CountryId,
  declinedName: string,
  outcome: "reselected" | "vacancy",
  reason: "declined" | "timeout" = "declined"
): Promise<void> {
  const { abbrev, chairTitle } = bankLabels(countryId);
  // A timeout is a passive lapse, not an active refusal — phrase it accordingly.
  const verb = reason === "timeout" ? "let the" : "declined the";
  const tail = reason === "timeout" ? " appointment lapse" : " appointment";
  const desc =
    outcome === "reselected"
      ? `**${declinedName}** ${verb} ${chairTitle}${tail}; another candidate will be proposed.`
      : `**${declinedName}** ${verb} ${chairTitle}${tail} and no replacement candidate could be seated; the office remains vacant.`;
  await sendMultiCountryGameEvent(chairEventRecipients(countryId), {
    title: `${abbrev}: ${chairTitle} ${reason === "timeout" ? "lapsed" : "declined"}`,
    description: desc,
    color: DISCORD_COLORS.govCollapsed,
  });
}
