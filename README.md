# DraftLens

DraftLens is a private, explainable AI-pattern coverage estimator for academic prose. Paste or import a report, review the share of qualifying prose detected by a calibrated local model, inspect reportable passages, and see the observable style evidence around each result.

**Live app:** [draftlens-seven.vercel.app](https://draftlens-seven.vercel.app)

> [!IMPORTANT]
> DraftLens is an independent estimate, not an authorship test. It cannot prove who wrote a document, is not a plagiarism checker, is not affiliated with Turnitin, and does not reproduce Turnitin's proprietary model.

## What it does

- Reads pasted text and local `.txt`, `.md`, `.docx`, and `.pdf` files up to 10 MB.
- Filters headings, list fragments, common table fragments, unsupported-language text, and bibliography entries out of the qualifying-prose denominator.
- Scores overlapping local windows and reports detected qualifying-word coverage instead of average stylistic intensity.
- Uses the conservative display states `0%`, `*%` for raw 1-19% results, and exact percentages from 20-100%.
- Requires at least 300 qualifying words for a reportable result.
- Highlights detected passages only when the document reaches the 20% reporting line.
- Retains explainable signals and revision coaching as secondary context.
- Runs entirely in the browser. DraftLens does not upload or save reports.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

## Verify

```bash
npm test
npm run lint
npm run build
```

The tests cover deterministic score bounds, coverage arithmetic, qualifying-prose exclusions, bibliography invariance, score suppression, sentence offsets, calibration behavior, and document import.

## How the estimate works

The version 2 pipeline follows the parts of Turnitin's workflow that are publicly documented without claiming access to its proprietary classifier:

1. Identify qualifying English long-form prose.
2. Analyze overlapping windows of approximately 5-10 sentences.
3. Average the window estimates for every qualifying sentence.
4. Mark sentences above a conservative, validation-derived threshold.
5. Report detected qualifying words divided by all qualifying words.

| Raw coverage | Display | Meaning |
| ---: | --- | --- |
| 0% | `0%` | No qualifying passage crossed the calibrated threshold. |
| 1-19% | `*%` | Exact score and highlights are suppressed because isolated low-coverage results are less reliable. |
| 20-49% | Exact | A reportable share of qualifying prose was detected. |
| 50-100% | Exact | A high share of qualifying prose was detected. |

The secondary pattern-intensity metric still summarizes visible stock phrasing, repeated openings and transitions, sentence-length uniformity, abstract wording, nominalizations, and low specificity. It is not used as the headline percentage.

## Calibration

The bundled `ghostbuster-essay-v2` profile is a compact logistic model over 22 passage-level features, trained with the CC BY 3.0 [Ghostbuster essay corpus](https://github.com/vivek3141/ghostbuster-data). Documents were split by prompt/file ID to prevent topic leakage. No source essay is bundled into the application.

On the held-out corpus, the profile produced 0.926 window ROC-AUC, about 0.6% human-document false positives at the 20% reporting line, and 65.0% AI-document recall. These are benchmark-specific results, not a promise of real-world or Turnitin-equivalent accuracy.

See [calibration and concordance](docs/calibration.md) for model provenance, public paired-report anchors, evaluation design, and release gates.

## Responsible interpretation

AI-text detection is an uncertain classification problem. Formal, technical, translated, template-based, or heavily edited human prose can resemble machine-generated prose, while newer models and paraphrasing can evade detection. Use the result as a review prompt:

1. Read every surfaced passage in context.
2. Compare it with notes, sources, and earlier drafts.
3. Ask the writer to explain the reasoning where appropriate.
4. Never use the percentage as the sole basis for an adverse decision.

Do not revise text merely to change a detector score. Keep changes accurate and reflective of the writer's own reasoning.

## Tech stack

- React + TypeScript + Vite
- `pdfjs-dist` for local PDF extraction
- `mammoth` for local DOCX extraction
- A deterministic, browser-side statistical profile with no runtime API call
- Vitest for analyzer and import tests

The analyzer is in [`src/lib/analyzer.ts`](src/lib/analyzer.ts), the feature extractor is in [`src/lib/statistical-features.ts`](src/lib/statistical-features.ts), and the generated profile is in [`src/data/calibration-profile.ts`](src/data/calibration-profile.ts).

## License

MIT
