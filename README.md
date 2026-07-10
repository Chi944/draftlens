# DraftLens

DraftLens is a private, explainable writing-pattern reviewer. Paste or import a report, get a 0–100 **AI-likeness pattern score**, inspect the exact passages that raised it, and work through concrete coaching for clearer, more specific writing.

**Live app:** [draftlens-seven.vercel.app](https://draftlens-seven.vercel.app)

> [!IMPORTANT]
> The score is a deterministic heuristic—not a probability of AI authorship. DraftLens cannot prove who wrote a document, is not a plagiarism checker, and is not affiliated with Turnitin, QuillBot, or any assessment platform.

## What it does

- Reads pasted text and local `.txt`, `.md`, `.docx`, and `.pdf` files up to 10 MB.
- Calculates an explainable 0–100 writing-pattern score and a separate sample-length confidence rating.
- Highlights mixed and elevated passages inside the original document.
- Shows the observable reason for every flag: stock wording, repeated openings or transitions, unusually uniform sentence lengths, abstract wording, nominalizations, and low specificity.
- Offers passage-aware revision coaching focused on evidence, clarity, specificity, and the writer's own voice.
- Runs entirely in the browser. A report is not uploaded or stored by DraftLens.

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

The analyzer tests cover deterministic score bounds, calibration, sentence offsets, confidence for short samples, flagged-passage grouping, and the product's methodology disclosures.

## How the score works

DraftLens uses a fixed, local rule set. Each sentence starts with a small baseline and gains visible signal points when one or more documented patterns occur. Sentence scores are weighted by word count for the report score. Adjacent sentences at or above the review threshold are grouped into selectable passages.

| Score | Label | Meaning |
| ---: | --- | --- |
| 0–39 | Few signals | Few of the tracked formulaic patterns appear. |
| 40–64 | Mixed signals | A noticeable concentration deserves review. |
| 65–100 | Elevated signals | A strong concentration of tracked patterns appears. |

Confidence is deliberately separate from the score and rises with the amount of analyzable text. A short sample can match a pattern strongly while still offering weak evidence overall.

The implementation lives in [`src/lib/analyzer.ts`](src/lib/analyzer.ts), and the typed result contract is in [`src/lib/types.ts`](src/lib/types.ts).

## Responsible interpretation

AI-text detection is an uncertain classification problem. More text generally improves the available evidence, and false positives remain possible. Turnitin itself notes that short submissions can be less accurate and that an AI-writing score should not be the sole basis for adverse action. Research also shows that reliable detection depends on the data distribution, detector, and available sample size.

Use DraftLens as an editing conversation starter:

1. Inspect the highlighted wording and the stated reason.
2. Check the claim against notes, sources, and firsthand reasoning.
3. Revise only when the suggestion makes the report more accurate and genuinely yours.
4. Keep drafts, source notes, and version history when authorship may matter.

Do not use a DraftLens score as evidence of misconduct or as a promise that another detector will return a particular result.

## Reference context

- [Turnitin AI writing detection release notes](https://guides.turnitin.com/hc/en-us/articles/28294949544717-AI-writing-detection-model) describe passage highlighting, a percentage over qualifying text, paraphrasing categories, and cautions around false positives and short submissions.
- [Chakraborty et al., ICML 2024](https://proceedings.mlr.press/v235/chakraborty24a.html) discuss the relationship between text quantity and detection reliability.
- [Tufts, Zhao, and Li, 2024](https://arxiv.org/abs/2412.05139) evaluate detector performance across unseen domains, models, and prompting strategies.

These sources inform the product's caution and interface conventions. DraftLens does not reproduce their proprietary models or claim comparable accuracy.

## Tech stack

- React + TypeScript + Vite
- `pdfjs-dist` for local PDF text extraction
- `mammoth` for local DOCX text extraction
- Vitest for the analyzer and import test suite

## License

MIT
