/** Default cap on how many candidates a helper returns. */
export const MAX_CANDIDATES = 100;

/** Label meaning "no candidate matched"; never a real candidate. */
export const NONE = "none";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Separator is spaces/tabs, not \s, so a name cannot merge across signature lines.
const NAME_RE = /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2}\b/g;
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const SIGNATURE_LINES = 15;

// NLTK's English stop-word list; `getListOfWords` filters these out by default.
const DEFAULT_STOP_WORDS = [
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you",
  "you're", "you've", "you'll", "you'd", "your", "yours", "yourself",
  "yourselves", "he", "him", "his", "himself", "she", "she's", "her", "hers",
  "herself", "it", "it's", "its", "itself", "they", "them", "their", "theirs",
  "themselves", "what", "which", "who", "whom", "this", "that", "that'll",
  "these", "those", "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having", "do", "does", "did", "doing", "a", "an",
  "the", "and", "but", "if", "or", "because", "as", "until", "while", "of",
  "at", "by", "for", "with", "about", "against", "between", "into", "through",
  "during", "before", "after", "above", "below", "to", "from", "up", "down",
  "in", "out", "on", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "any", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will",
  "just", "don", "don't", "should", "should've", "now", "d", "ll", "m", "o",
  "re", "ve", "y", "ain", "aren", "aren't", "couldn", "couldn't", "didn",
  "didn't", "doesn", "doesn't", "hadn", "hadn't", "hasn", "hasn't", "haven",
  "haven't", "isn", "isn't", "ma", "mightn", "mightn't", "mustn", "mustn't",
  "needn", "needn't", "shan", "shan't", "shouldn", "shouldn't", "wasn",
  "wasn't", "weren", "weren't", "won", "won't", "wouldn", "wouldn't",
];

/** Keep first-seen order, drop blanks, duplicates, and the `none` label. */
export function dedupe(values: Iterable<string>, limit: number): string[] {
  if (limit <= 0) return [];
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
export function displayName(from: string): string {
  const name = from.split("<")[0].trim().replace(/^["']|["']$/g, "").trim();
  return name.includes("@") ? "" : name;
}

/** The last few non-empty lines, where a signature and its sender name live. */
export function signatureRegion(body: string): string {
  const lines = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  return lines.slice(-SIGNATURE_LINES).join("\n");
}

/** Proper-noun sequences in the text, deduped and capped. */
export function getListOfProperNouns(
  text: string,
  options: { max?: number } = {}
): string[] {
  return dedupe(text.match(NAME_RE) ?? [], options.max ?? MAX_CANDIDATES);
}

/** Email addresses in the text, deduped and capped. */
export function getListOfEmailAddresses(
  text: string,
  options: { max?: number } = {}
): string[] {
  return dedupe(text.match(EMAIL_RE) ?? [], options.max ?? MAX_CANDIDATES);
}

/**
 * Words in the text minus stop words, deduped and capped.
 * `stopWords` replaces the default list; `additionalStopWords` extends it.
 */
export function getListOfWords(
  text: string,
  options: {
    stopWords?: string[];
    additionalStopWords?: string[];
    max?: number;
  } = {}
): string[] {
  const stop = new Set(
    [
      ...(options.stopWords ?? DEFAULT_STOP_WORDS),
      ...(options.additionalStopWords ?? []),
    ].map((word) => word.toLowerCase())
  );
  const words = (text.match(WORD_RE) ?? []).filter(
    (word) => !stop.has(word.toLowerCase())
  );
  return dedupe(words, options.max ?? MAX_CANDIDATES);
}
