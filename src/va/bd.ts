/** Small display helpers shared by the screens: Bangla digits and the assistant's {owner}-style placeholders. */

const BN = '০১২৩৪৫৬৭৮৯';

/** Latin digits to Bangla digits ("12" becomes "১২"). Anything that is not a digit is left alone. */
export function bd(n: number | string): string {
  return String(n).replace(/[0-9]/gu, (d) => BN[Number(d)] ?? d);
}

/** A number for the current language: Bangla digits in Bangla, plain Latin digits in English. */
export function num(n: number | string, bn: boolean): string {
  return bn ? bd(n) : String(n);
}

/**
 * Fill the placeholders of a sentence the server stores ({owner}, {assistant}, {reply_by}) for DISPLAY only.
 * Edit boxes must keep the raw text. Falls back to a friendly name when none is set.
 */
export function fillOwner(text: string, ownerName?: string | null, extra?: { assistant?: string | null; replyBy?: string | null; bn?: boolean }): string {
  const owner = (ownerName ?? '').trim() || (extra?.bn === false ? 'Sumon' : 'সুমন ভাই');
  let out = text.replace(/\{owner\}/gu, owner);
  if (extra?.assistant) out = out.replace(/\{assistant\}/gu, extra.assistant);
  if (extra?.replyBy) out = out.replace(/\{reply_by\}/gu, extra.replyBy);
  return out;
}

/** Hero gradients by meaning (all dark enough for white text): all fine = green, warning = dark amber, serious = red. */
export const HERO_OK: [string, string] = ['#15803D', '#0F766E'];
export const HERO_WARN: [string, string] = ['#92400E', '#B45309'];
export const HERO_BAD: [string, string] = ['#B91C1C', '#DC2626'];
