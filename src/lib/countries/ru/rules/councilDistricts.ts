/**
 * First-Council elections freeze one two-seat ballot in every federal subject.
 * planRussianCouncilDistricts requires all 89 subject registers, keeping nested
 * autonomous okrugs separate from their parent oblasts and krais.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";

export function planRussianCouncilDistricts(registeredBySubject: Readonly<Record<string, number>>) {
  const expected = RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number]) => `RU-council-${number}`);
  if (
    Object.keys(registeredBySubject).length !== expected.length ||
    expected.some(
      (id) =>
        !Object.prototype.hasOwnProperty.call(registeredBySubject, id) ||
        !Number.isSafeInteger(registeredBySubject[id]) ||
        registeredBySubject[id] < 0
    )
  )
    throw new Error("Council districts need the complete frozen 89-subject register");
  const total = expected.reduce((sum, id) => sum + BigInt(registeredBySubject[id]), BigInt(0));
  if (total < BigInt(1) || total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The Russian Council electorate is empty or exceeds precision");
  return RUSSIAN_COUNCIL_SUBJECTS_1993.map(([districtNumber, name, regionId]) => {
    const seatId = `RU-council-${districtNumber}`;
    return {
      seatId,
      districtNumber,
      name,
      regionId,
      registeredVoters: registeredBySubject[seatId],
      totalSeats: 2 as const,
    };
  });
}
