/**
 * Central bank chair lobbying — per-request contribution bounds.
 * Selection weight uses LOBBY_SCALE_FACTOR in `centralBankChairSelection` ($500k → doubles baseline weight).
 *
 * Note: No hardcoded max — practical limit is the user's liquid wealth and the wire transfer
 * daily cap (₳5M anchor units). Minimum is 1 to prevent accidental zero-value transactions.
 */

export const CENTRAL_BANK_LOBBY_MIN_AMOUNT = 1;
export const CENTRAL_BANK_LOBBY_DEFAULT_AMOUNT = 10_000;
