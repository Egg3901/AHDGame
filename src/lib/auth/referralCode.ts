import { ObjectId, type Collection, type Document } from "mongodb";
import { OAUTH_REFERRAL_CODE_COOKIE } from "@/lib/auth/oauthFingerprint";
import { normalizeReferralCode } from "@/lib/auth/normalizeReferralCode";

export { normalizeReferralCode };

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
  delete: (name: string) => void;
};

/**
 * Read + clear `__ahd_oauth_ref`, look up the referrer, and return their
 * ObjectId. Invalid / unknown codes are ignored (never block registration).
 *
 * Server-only — imports MongoDB.
 */
export async function resolveReferredByFromOAuthCookie(
  cookieStore: CookieReader,
  usersCollection: Pick<Collection<Document>, "findOne">
): Promise<ObjectId | undefined> {
  const raw = cookieStore.get(OAUTH_REFERRAL_CODE_COOKIE)?.value;
  cookieStore.delete(OAUTH_REFERRAL_CODE_COOKIE);
  const code = normalizeReferralCode(raw);
  if (!code) return undefined;

  const referrer = await usersCollection.findOne({ _id: new ObjectId(code) });
  return referrer?._id instanceof ObjectId ? referrer._id : undefined;
}
