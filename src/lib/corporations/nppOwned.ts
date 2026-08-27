/**
 * Is this corporation part of the NPP field, or is it somebody's?
 *
 * `ceoType === "npp"` alone is NOT the answer, and that is the whole reason this
 * lives in one place. Under NPP-autonomy V2.1 a player may hand their own corp to
 * an NPP caretaker: the autonomy brain drives it through `ceoType: "npp"`, but
 * `userId` deliberately stays the appointing owner so they keep CEO authorization
 * and private-data access. That corp is a player's corp being minded, not part of
 * the NPP field, and grouping it with the NPPs would tell its owner their own
 * company had been absorbed into the background.
 *
 * The presence of `caretakerCeo` is what separates the two, matching the test
 * `subsidiaries/parentContext.ts` already uses when it decides which corps have a
 * real owner to walk up to.
 *
 * A corp with no `ceoType` at all is player-owned: the field defaults to
 * `"character"` and predates NPP corps entirely.
 */
export function isNppOwned(
  corp: { ceoType?: string | null; caretakerCeo?: unknown } | null | undefined
): boolean {
  if (!corp) return false;
  return corp.ceoType === "npp" && !corp.caretakerCeo;
}
