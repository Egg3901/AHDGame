import { badRequest } from "./errors";

const DEFAULT_COUNTRY = "US";

type CountryEntity = { countryId?: string | null } | null | undefined;

export function resolveCountry(entity: CountryEntity): string {
  return entity?.countryId ?? DEFAULT_COUNTRY;
}

export function isSameCountry(a: CountryEntity, b: CountryEntity): boolean {
  return resolveCountry(a) === resolveCountry(b);
}

export function assertSameCountry(
  actor: CountryEntity,
  target: CountryEntity,
  options?: { message?: string }
): void {
  if (!isSameCountry(actor, target)) {
    throw badRequest(
      options?.message ?? "You cannot perform political actions across different countries"
    );
  }
}
