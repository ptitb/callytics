import {
  normalizeOutboundNumber,
  type OutboundNumberSettings,
} from './outboundNumber';

export type CallerMatchType = 'exact' | 'prefix' | 'anonymous';

export interface CallerMatchRule {
  branch: string;
  label?: string;
  match: CallerMatchType;
  /** Comma or newline separated numbers. Not used by the anonymous match. */
  value?: string;
}

export interface CallerMatchConfig {
  rules?: CallerMatchRule[];
}

export interface CallerMatchResult {
  /** Branch key of the first matching rule, or "default" when no rule matches. */
  branch: string;
  /** The caller number after normalisation, or null when the caller is anonymous. */
  normalizedCaller: string | null;
}

/** Caller ids that mean "no number": what Asterisk delivers for a withheld caller. */
const ANONYMOUS_CALLER_IDS = new Set(['', 'anonymous', 'unknown', 'restricted', 'private']);

/** A bare digit string of this length is taken as an international number without the + sign. */
const MIN_BARE_INTERNATIONAL_DIGITS = 9;

/**
 * Brings a phone number to E.164-like form (+ followed by digits) so caller ids
 * and rule values can be compared. Returns null when the value is not a number,
 * which is the case for an empty or withheld caller id.
 *
 * - Spaces, dashes, dots and parentheses are removed.
 * - 00X... becomes +X... (the international prefix of the outbound settings).
 * - 0X... becomes +<country code>X... (the country code of the outbound settings).
 * - 31612345678 (digits only, no leading 0, as some providers deliver) becomes +31612345678.
 * - Short numbers such as extensions keep their digits without a +.
 */
export function normalizeCallerNumber(raw: string, settings: OutboundNumberSettings): string | null {
  const cleaned = String(raw ?? '').replace(/[\s\-.()]/g, '');
  if (ANONYMOUS_CALLER_IDS.has(cleaned.toLowerCase()) || !/^\+?\d+$/.test(cleaned)) {
    return null;
  }

  const e164 = normalizeOutboundNumber(cleaned, { ...settings, normalizeE164: true });
  if (!e164.startsWith('+') && e164.length >= MIN_BARE_INTERNATIONAL_DIGITS && !e164.startsWith('0')) {
    return `+${e164}`;
  }
  return e164;
}

/** Splits a rule value on commas and newlines and normalises each entry. Entries that are not numbers are dropped. */
export function parseRuleNumbers(value: unknown, settings: OutboundNumberSettings): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(/[,\n]/)
    .map((entry) => normalizeCallerNumber(entry, settings))
    .filter((entry): entry is string => entry !== null);
}

function ruleMatches(rule: CallerMatchRule, caller: string | null, settings: OutboundNumberSettings): boolean {
  if (rule.match === 'anonymous') {
    return caller === null;
  }
  if (caller === null) {
    return false;
  }

  const numbers = parseRuleNumbers(rule.value, settings);
  if (rule.match === 'exact') {
    return numbers.includes(caller);
  }
  if (rule.match === 'prefix') {
    return numbers.some((prefix) => caller.startsWith(prefix));
  }
  return false;
}

/** Evaluates the rules in order. The first rule that matches decides the branch. */
export function evaluateCallerMatch(
  config: CallerMatchConfig,
  rawCaller: string,
  settings: OutboundNumberSettings,
): CallerMatchResult {
  const caller = normalizeCallerNumber(rawCaller, settings);
  const rules = Array.isArray(config.rules) ? config.rules : [];
  const matched = rules.find((rule) => ruleMatches(rule, caller, settings));
  return { branch: matched ? matched.branch : 'default', normalizedCaller: caller };
}
