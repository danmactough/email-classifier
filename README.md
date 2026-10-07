# email-classifier

Streams an mbox archive (like you can get from Google Takeout), filters the messages, and classifies each one with a pluggable classifier: free-text binary questions about subscriptions, physical goods, services, and free trials (including auto-convert-to-paid behavior); a transaction-category select (e.g. `order_receipt`, `trial_ending`, `refund_issued`); and the sender's name and email address extracted from per-message candidates. Results are rendered as a self-contained HTML report (with the original HTML body inlined per message) plus a console summary.

The question set lives in `src/questions.ts` in a classifier-neutral shape (`binary` / `score` / `select`); each classifier translates it onto its API's wire format and maps the answers back (`src/classifiers/`).

Leave `CLASSIFIER` unset for a dry run: parse and filter only, no API calls.

## Usage

```sh
npm start -- path/to/mail.mbox
```

Configuration comes from `.env` or the environment:

| Variable                                       | Purpose                                                            | Default                          |
| ---------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `CLASSIFIER`                                   | `jev`, `openai`, or `ollama`; unset for dry run                    | unset (dry run)                  |
| `MBOX_PATH`                                    | Fallback for the positional mbox path                              | unset (positional path required) |
| `FROM_FILTER`, `SUBJECT_FILTER`, `DATE_FILTER` | Regexes (case-insensitive) the message must match to be classified | `.*` (matches everything)        |
| `BODY_FILTER`                                  | Regex (dotall) the body must match                                 | `.*` (matches everything)        |
| `DATE_SINCE`                                   | ISO date; classify only messages on or after it                    | `1970-01-01T00:00:00Z`           |
| `LOG_SKIPPED`                                  | Log why each message is skipped                                    | unset (no logging)               |

Each run writes `reports/<classifier>-report-<timestamp>.html`.

## Development

Lint and format come from [Vite+](https://viteplus.dev) (`vite-plus`), which also provides the Vitest 5 runner; tests and lint use type-aware rules via tsgolint.

```sh
npm test              # vitest (via vp test)
npm run typecheck     # tsc --noEmit
npx vp check          # lint + format + type-check everything
npx vp check --fix    # same, autofixing formats and lint findings
```

## Adding a new classifier

1. Create `src/classifiers/<name>.ts` extending `Classifier` (`base.ts`). The port has three methods: `translateQuestions` maps the generic questions onto the API's wire format, `translateAnswers` maps the raw response back into generic answers, and `classify` composes them — truncate the body with `truncateBody`, build the header block with `headerBlock`, build the question set with `buildQuestions({ email })`, and return `{ id: email.messageId, email, answers, truncated }`. See `jev.ts` and `openai.ts` for working examples.
2. Register it in `src/classifiers/index.ts`: add a case to `createClassifier` that requires its credentials from the environment when the service needs any (throw `CLASSIFIER=<name> requires <API_KEY>` when missing) and update the `unsupported CLASSIFIER` message to include the new name.
3. Add tests: `<name>.test.ts` covering the wire mappings for every generic question kind and the answer mapping for every answer type (copy the pattern from `jev.test.ts` — a fixture question set, a stubbed global fetch, an end-to-end `classify`), plus a factory case in `index.test.ts` for the API-key requirement.
4. Add the API key variable to the env table above.
