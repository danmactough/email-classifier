import {
  choice,
  noul,
  type ChoiceQuestion,
  type NoulQuestion,
} from "@typesafe-ai/sdk";
import type { ParsedEmail, SenderCandidates } from "./types.ts";

export const CATEGORIES = [
  "promotion_spam",
  "new_trial_notification",
  "trial_expiration_notice",
  "subscription_confirmation",
  "subscription_renewal",
  "subscription_cancellation",
  "order_receipt",
  "shipping_update",
  "return_received",
  "refund_issued",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  promotion_spam:
    "Marketing, advertising, newsletters, or unsolicited bulk mail. No transaction and no subscription the recipient holds.",
  new_trial_notification:
    "Confirms a free trial has just started or been activated.",
  trial_expiration_notice:
    "Warns that a free trial is ending soon or has ended and will convert to paid.",
  subscription_confirmation:
    "Confirms a paid subscription was created or its plan changed. Not the start of a trial.",
  subscription_renewal:
    "Says an existing paid subscription was renewed or a recurring charge was made.",
  subscription_cancellation:
    "Confirms a subscription or membership was cancelled or will not renew.",
  order_receipt:
    "Confirms a one-time order or payment that is not a subscription.",
  shipping_update:
    "Reports that an order shipped, is in transit, or was delivered.",
  return_received: "Confirms a returned item was received by the seller.",
  refund_issued: "Confirms money was refunded to the customer.",
  other: "Anything that fits none of the above.",
};

/** The six questions asked about one email; answer keys are inferred from this map. */
export type EmailQuestionMap = {
  related_to_subscription: NoulQuestion;
  related_to_physical_goods: NoulQuestion;
  related_to_services: NoulQuestion;
  category: ChoiceQuestion<Record<Category, string>>;
  sender_name: ChoiceQuestion;
  sender_email: ChoiceQuestion;
};

export type EmailQuestions = EmailQuestionMap;

const NONE = "none";
const MAX_CANDIDATES = 100;
const SIGNATURE_LINES = 15;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Separator is spaces/tabs, not \s, so a name cannot merge across signature lines.
const NAME_RE = /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2}\b/g;

/** Keep first-seen order, drop blanks, duplicates, and the `none` label. */
function dedupe(values: Iterable<string>, limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!item || item === NONE || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** The display name from the From header, or "" when it is just an address. */
function displayName(from: string): string {
  const name = from.split("<")[0].replace(/["']/g, "").trim();
  return name.includes("@") ? "" : name;
}

/** The last few non-empty lines, where a signature and its sender name live. */
function signatureRegion(body: string): string {
  const lines = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  return lines.slice(-SIGNATURE_LINES).join("\n");
}

/** Find over-broad candidate names and email addresses in the message. */
export function findSenderCandidates(email: ParsedEmail): SenderCandidates {
  const names = signatureRegion(email.body).match(NAME_RE) ?? [];
  const emails = email.raw.match(EMAIL_RE) ?? [];
  return {
    names: dedupe([displayName(email.from), ...names], MAX_CANDIDATES),
    emails: dedupe(emails, MAX_CANDIDATES),
  };
}

function optionMap(
  values: string[],
  none: string
): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const value of values) criteria[value] = null;
  criteria[NONE] = none;
  return criteria;
}

/** Build the Jev question set for one email (criteria include the candidates). */
export function buildQuestions(options: {
  email: ParsedEmail;
}): EmailQuestions {
  const candidates = findSenderCandidates(options.email);

  return {
    related_to_subscription: noul(
      "Does this email relate to a subscription: a recurring, auto-renewing service, membership, or plan?"
    ),
    related_to_physical_goods: noul(
      "Does this email relate to purchasing physical good(s): tangible items that are shipped or delivered?"
    ),
    related_to_services: noul(
      "Does this email relate to purchasing service(s): work, access, or expertise rather than a physical item?"
    ),
    category: choice(
      "What kind of email is this, based on the transaction or subscription event it describes?",
      CATEGORY_DESCRIPTIONS
    ),
    sender_name: choice(
      "What is the sender's name: the brand or person evident in the message signature?",
      optionMap(candidates.names, "No candidate is the sender's name.")
    ),
    sender_email: choice(
      "What is the sender's email address?",
      optionMap(candidates.emails, "No candidate is the sender's email address.")
    ),
  };
}
