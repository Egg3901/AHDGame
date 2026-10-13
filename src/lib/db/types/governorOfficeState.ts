import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Devolution Policy stance, chosen by UK First Ministers (SCO/WAL/NIR).
 * `"independence"` label varies in UI per region — SCO/WAL render
 * "Independence", NIR renders "Irish Reunification". Engine math is
 * shared. See `docs/design/uk-devolution-policy.md`.
 */
export type DevolutionPolicy = "anti" | "pro" | "independence";

/**
 * One document per active regional-executive office-holder.
 * Stores the office-AP pool. Address cooldown lives on governorAddresses;
 * this collection only holds AP state.
 * Collection: "governorOfficeState"
 */
export interface GovernorOfficeState {
  _id?: ObjectId;
  countryId: CountryId;
  stateId: string;
  /** Denormalized current office-holder. Nullable so a national-pseudo-stateId
   *  row can exist with no installed leader (admin override path can still
   *  spend AP), and so NPP-held seats — which have no character — are seedable. */
  characterId: ObjectId | null;
  characterName: string;

  /** Office action points (cap GUBERNATORIAL_ACTION_CAP). */
  gubernatorialActions: number;
  /** Request serialization counter. Runtime office rows are wiped on reset. */
  referendumRequestRevision?: number;
  /** Turn when the AP pool last incremented. */
  lastActionGrantedTurn: number;
  /** Turn the holder last bought +1 office action with main AP (once per turn). */
  lastGubernatorialActionTopUpTurn?: number;

  /**
   * UK FM Devolution Policy — only meaningful when
   * `(countryId === "UK" && stateId in {SCO, WAL, NIR})`. Drives the
   * region's `independenceDesire` drift on `StateMetrics.governance`.
   * Other countries / regions leave this undefined.
   */
  devolutionPolicy?: DevolutionPolicy;
  /** Turn the policy was last changed. Used to enforce the 72-turn
   *  cooldown before the next change is allowed. */
  devolutionPolicyChangedAtTurn?: number;

  /** UK national office only. Missing regions fall back to anti; handovers preserve policy. */
  westminsterStances?: Partial<
    Record<
      "SCO" | "WAL" | "NIR",
      {
        policy: DevolutionPolicy;
        changedAtTurn?: number;
        /** Ministry that last changed this stance. Optional on pre-feature saves. */
        changedUnderGovernment?: string;
      }
    >
  >;

  createdAt: Date;
  updatedAt: Date;
}
