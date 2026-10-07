import {
  MAX_CANDIDATES,
  NONE,
  dedupe,
  getListOfEmailAddresses,
  getListOfProperNouns,
  signatureRegion,
} from "./helpers.ts";
import type { ParsedEmail, Question } from "./types.ts";

/** The category vocabulary: what kind of transactional/subscription email this is. */
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

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
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
  order_receipt: "Confirms a one-time order or payment that is not a subscription.",
  shipping_update: "Reports that an order shipped, is in transit, or was delivered.",
  return_received: "Confirms a returned item was received by the seller.",
  refund_issued: "Confirms money was refunded to the customer.",
  other: "Anything that fits none of the above.",
};

/** Build the generic question set for one email (candidates become sender options). */
export function buildQuestions(options: { email: ParsedEmail }): Question[] {
  const candidateEmails = getListOfEmailAddresses(options.email.raw);
  // Signature-tail names come first so a name-dense body cannot crowd the real
  // sender name out of the MAX_CANDIDATES cap; the whole body still contributes.
  const candidateNames = dedupe(
    [
      options.email.fromParsed.name,
      ...getListOfProperNouns(signatureRegion(options.email.body)),
      ...getListOfProperNouns(options.email.body),
    ],
    MAX_CANDIDATES,
  );

  const binary = (
    name: string,
    question: string,
    criteria?: { true: string; false: string },
  ): Question => ({ kind: "binary", name, question, criteria });

  return [
    binary(
      "related_to_subscription",
      "Does this email relate to a subscription: a recurring, auto-renewing service, membership, or plan?",
    ),
    binary(
      "related_to_physical_goods",
      "Does this email relate to purchasing physical good(s): tangible items that are shipped or delivered?",
    ),
    binary(
      "related_to_services",
      "Does this email relate to purchasing service(s): work, access, or expertise rather than a physical item?",
    ),
    binary(
      "involves_free_trial",
      "Does this email concern a free trial — a period during which a product, service, or subscription is provided at no cost to evaluate it?",
      {
        true: "Mentions a free trial, trial period, trial membership, or trial subscription: its start, an ending reminder, a conversion to paid, or its cancellation.",
        false:
          "No free trial is mentioned. The word 'trial' appears only in another sense (a trial run, a legal trial, a product name), or the email concerns a paid subscription or order with no free trial.",
      },
    ),
    binary(
      "free_trial_auto_converts",
      "Does this email indicate that a free trial automatically converts into a paid subscription and charges the recipient unless they cancel before it ends?",
      {
        true: "Says the trial becomes a paid subscription at the end, that the recipient must cancel to avoid a charge, or that a charge or renewal follows the trial.",
        false:
          "The trial ends with no charge, no payment method is required, the trial is already on a paid plan, or the email does not connect the trial to a paid subscription.",
      },
    ),
    {
      kind: "select",
      name: "category",
      question:
        "What kind of email is this, based on the transaction or subscription event it describes?",
      options: Object.entries(CATEGORY_DESCRIPTIONS).map(([value, description]) => ({
        value,
        description,
      })),
    },
    {
      kind: "select",
      name: "sender_name",
      question: "What is the sender's name: the brand or person evident in the message signature?",
      options: [
        ...candidateNames.map((value) => ({ value })),
        { value: NONE, description: "No candidate is the sender's name." },
      ],
    },
    {
      kind: "select",
      name: "sender_email",
      question: "What is the sender's email address?",
      options: [
        ...candidateEmails.map((value) => ({ value })),
        { value: NONE, description: "No candidate is the sender's email address." },
      ],
    },
  ];
}
