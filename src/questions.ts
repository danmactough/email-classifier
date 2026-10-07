import {
  choice,
  noul,
  type ChoiceQuestion,
  type NoulQuestion,
} from "@typesafe-ai/sdk";
import {
  MAX_CANDIDATES,
  NONE,
  dedupe,
  getListOfEmailAddresses,
  getListOfProperNouns,
  signatureRegion,
} from "./helpers.ts";
import type { ParsedEmail } from "./types.ts";

export const CATEGORIES = [
  "promotion_spam",
  "trial_started",
  "trial_ending",
  "trial_converted",
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
  trial_started: "Confirms a free trial has just started or been activated.",
  trial_ending: "Warns that a free trial is ending soon or has ended.",
  trial_converted:
    "Confirms a free trial has become a paid subscription, or that a charge was made when the trial ended.",
  subscription_confirmation:
    "Confirms a paid subscription was created or its plan changed. Not the start of a free trial.",
  subscription_renewal:
    "Says an existing paid subscription was renewed or a recurring charge was made. Not the transition from a free trial to paid.",
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

/** The eight questions asked about one email; answer keys are inferred from this map. */
export type EmailQuestionMap = {
  related_to_subscription: NoulQuestion;
  related_to_physical_goods: NoulQuestion;
  related_to_services: NoulQuestion;
  involves_free_trial: NoulQuestion;
  free_trial_auto_converts: NoulQuestion;
  category: ChoiceQuestion<Record<Category, string>>;
  sender_name: ChoiceQuestion;
  sender_email: ChoiceQuestion;
};

export type EmailQuestions = EmailQuestionMap;

function optionMap(
  values: string[],
  none: string
): Record<string, string | null> {
  const criteria: Record<string, string | null> = {};
  for (const value of values) criteria[value] = null;
  criteria[NONE] = none;
  return criteria;
}

/** Build the classifier's question set for one email (criteria include the candidates). */
export function buildQuestions(options: {
  email: ParsedEmail;
}): EmailQuestions {
  const candidateEmails = getListOfEmailAddresses(options.email.raw);
  // Signature-tail names come first so a name-dense body cannot crowd the real
  // sender name out of the MAX_CANDIDATES cap; the whole body still contributes.
  const candidateNames = dedupe(
    [
      options.email.fromParsed.name,
      ...getListOfProperNouns(signatureRegion(options.email.body)),
      ...getListOfProperNouns(options.email.body),
    ],
    MAX_CANDIDATES
  );

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
    involves_free_trial: noul(
      "Does this email concern a free trial — a period during which a product, service, or subscription is provided at no cost to evaluate it?",
      {
        true: "Mentions a free trial, trial period, trial membership, or trial subscription: its start, an ending reminder, a conversion to paid, or its cancellation.",
        false: "No free trial is mentioned. The word 'trial' appears only in another sense (a trial run, a legal trial, a product name), or the email concerns a paid subscription or order with no free trial.",
      }
    ),
    free_trial_auto_converts: noul(
      "Does this email indicate that a free trial automatically converts into a paid subscription and charges the recipient unless they cancel before it ends?",
      {
        true: "Says the trial becomes a paid subscription at the end, that the recipient must cancel to avoid a charge, or that a charge or renewal follows the trial.",
        false: "The trial ends with no charge, no payment method is required, the trial is already on a paid plan, or the email does not connect the trial to a paid subscription.",
      }
    ),
    category: choice(
      "What kind of email is this, based on the transaction or subscription event it describes?",
      CATEGORY_DESCRIPTIONS
    ),
    sender_name: choice(
      "What is the sender's name: the brand or person evident in the message signature?",
      optionMap(candidateNames, "No candidate is the sender's name.")
    ),
    sender_email: choice(
      "What is the sender's email address?",
      optionMap(candidateEmails, "No candidate is the sender's email address.")
    ),
  };
}
