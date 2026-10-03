/** Empty 1991 player starts let founders create historical party identities. */
export function retainsDefaultPartyNameReservation(input: {
  preset?: string;
  startingPartiesMode?: string;
  playerCountry: boolean;
}): boolean {
  return !(
    input.preset === "1991-default" &&
    input.startingPartiesMode === "none" &&
    input.playerCountry
  );
}
