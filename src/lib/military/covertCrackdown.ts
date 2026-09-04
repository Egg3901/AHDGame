import type { Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { applyTensionEvent } from "@/lib/coldwar/tension";
import { createSystemNewsPost } from "@/lib/news";
import { CRACKDOWN_TENSION_SPIKE } from "@/lib/military/covertNuclear";

/**
 * A crackdown embarrasses the government that got caught: modest approval hit,
 * applied the same way crisis approval effects land (a flat $inc on the
 * governmentApprovals doc, which the approval dynamics then work back).
 */
export const CRACKDOWN_APPROVAL_HIT = -3;

/**
 * The public half of a covert-programme crackdown: a world tension spike, an
 * approval hit at home, and a wire story that names undeclared facilities but
 * never the programme's actual stage. The public learns there was SOMETHING,
 * not what.
 *
 * Extracted so the two paths that can trigger it share one implementation. The
 * programme's own per-turn discovery roll is one; the patron's intelligence
 * service acting on what it has found is the other, and they are the same event
 * from the outside. Neither should drift from the other by being written twice.
 */
export async function applyCovertCrackdown(
  db: Db,
  countryId: CountryId,
  turn: number
): Promise<void> {
  const countryName = COUNTRY_CONFIGS[countryId].name;
  await applyTensionEvent(
    db,
    turn,
    "crisis",
    "Soviet inspectors raid East German facilities",
    CRACKDOWN_TENSION_SPIKE
  );
  await db
    .collection("governmentApprovals")
    .updateOne(
      { _id: countryId as unknown as ObjectId },
      { $inc: { approvalRating: CRACKDOWN_APPROVAL_HIT } }
    );
  await createSystemNewsPost(
    `Soviet inspection teams have raided undeclared industrial facilities in the ${countryName}. Moscow has issued a formal rebuke. Officials in Berlin declined to comment.`,
    "executive",
    { title: "Soviet Crackdown in East Germany" }
  );
}
