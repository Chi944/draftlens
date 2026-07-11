# DraftLens

DraftLens is a private, explainable writing-pattern review app. It imports a document, estimates the share of qualifying prose that crosses a calibrated statistical threshold, shows the signed model terms behind each reportable passage, and stages revision suggestions as changes the writer must review.

**Live app:** [draftlens-seven.vercel.app](https://draftlens-seven.vercel.app)

> [!IMPORTANT]
> DraftLens is an independent estimate, not an authorship test. It cannot prove who wrote a document, is not a plagiarism checker, is not affiliated with Turnitin, and does not reproduce Turnitin's proprietary classifier.

## Current workflow

1. **Add:** upload `.txt`, `.md`, `.docx`, or `.pdf`, or paste text.
2. **Summary:** read the coverage calculation, sample sufficiency, and signed document-level model factors.
3. **Evidence:** inspect one passage at a time, including source-page references, model factors that raised or lowered the local estimate, and review status.
4. **Revise:** accept or reject tracked edits, verify protected facts and citations, preview the new audit, and then apply the draft.
5. **Export:** download an audit report, a highlighted evidence document, or a clean Word document.

The import pipeline reconstructs PDF reading order, removes recurring headers, footers, and page numbers, detects sparse pages, and can run English OCR locally with Tesseract. Import and analysis both expose progress and cancellation. Draft text recovery uses only the current browser tab's `sessionStorage`.

## Score semantics

The headline percentage is detected qualifying-word coverage:

```text
words inside detected passages / all qualifying prose words
```

| Raw diagnostic | Display | Meaning |
| ---: | --- | --- |
| 0% | `0%` | No qualifying passage crossed the calibrated threshold. |
| 1–19% | `*%` | The exact result and highlights are suppressed because isolated low coverage is less reliable. |
| 20–100% | Exact | The displayed share of qualifying prose lies inside detected passages. |
| Unsupported domain | No percentage | The model is being driven beyond its calibration support, so DraftLens refuses to extrapolate. |

`Review` means a detected passage has a local model estimate below 95/100. `Elevated` means the local estimate is at least 95/100. Both are inspection bands, not authorship findings.

Model factors are signed logistic-model contributions: positive values raised the estimate and negative values lowered it. Writing characteristics are shown separately because a descriptive property is not proof of authorship.

## Saturation guard

The `ghostbuster-essay-v3-domain-gated` profile retains the existing 22-feature coefficients and `0.861392` detection threshold. It adds data-generated 99.5th-percentile support bounds for long-word density and concentrated lexical model pressure. An exact result is withheld only when both bounds are exceeded.

This fixes the formal-academic saturation failure without hiding formulaic in-domain prose. On the supplied 52-page academic report, the old raw diagnostic remains high internally, but the public result is now `Outside calibrated domain`, the percentage is withheld, and no passage is presented as reportable evidence.

The held-out Ghostbuster essay benchmark produced 0.926 window ROC-AUC, 0.61% human documents at or above the 20% reporting line, and 64.99% AI-document recall. These are corpus-specific measurements, not real-world guarantees. See [calibration and concordance](docs/calibration.md) for provenance, support bounds, public report anchors, and release gates.

## Revision safety

The local Revision Lab performs deterministic clarity cleanup and displays every proposed change with accept/reject controls. Numbers, citations, quotations, names, negations, and qualifiers are protected: changing them requires explicit acknowledgement before application.

An optional contextual editor can revise only the selected passage for clarity, concision, or stronger reasoning. It is opt-in, requests `store: false`, uses a strict structured response, and explicitly refuses detector-evasion instructions. The feature remains disabled unless the deployment has both an `OPENAI_API_KEY` and `CONTEXTUAL_REVISION_ENABLED=true`; all analysis and local tracked revision continue to work without it.

Do not revise text merely to lower a detector score. Keep every change accurate and reflective of the writer's own reasoning.

## Privacy and offline behavior

- Analysis, PDF extraction, OCR, and Word generation run in the browser.
- DraftLens itself does not persist reports or draft text on a server. Tab recovery uses browser `sessionStorage` and expires after eight hours.
- The optional contextual editor relays only the selected passage through Vercel to OpenAI after explicit consent. `store: false` disables reusable response storage, but OpenAI abuse-monitoring retention may still apply unless the project has approved data controls.
- The installable app caches its lightweight shell and analyzer. Large PDF, OCR, and export assets remain lazy and are cached after use.
- API availability responses are never placed in the service-worker cache.

## Run locally

```bash
npm install
npm run dev
```

The optional contextual endpoint is a Vercel function in `api/revise.js`:

```bash
# Optional; do not expose this value to Vite/client code.
vercel env add OPENAI_API_KEY
vercel env add CONTEXTUAL_REVISION_ENABLED
vercel env add OPENAI_REVISION_MODEL
```

Set `CONTEXTUAL_REVISION_ENABLED` to `true` only after configuring platform-level rate limiting and spend controls. If `OPENAI_REVISION_MODEL` is omitted, the endpoint defaults to `gpt-5.4-mini`. The function also applies a small warm-instance concurrency and request limit, but those controls are not a substitute for an edge-backed global limit.

## Verify

```bash
npm test
npm run lint
npm run build
```

Coverage includes calibration behavior, domain suppression, sentence and page offsets, header/content/reference exclusion, OCR and cancellation, background-worker fallback, recovery, tracked/protected revision, all three Word exports, the PWA shell, and the Summary → Evidence → Revise interaction flow.

## Tech stack

- React, TypeScript, and Vite
- `pdfjs-dist` for local PDF extraction
- Tesseract.js with bundled English data for lazy local OCR
- `mammoth` for local DOCX extraction
- `docx` for client-side Word generation
- A deterministic browser-side statistical profile
- An optional OpenAI Responses API Vercel function for selected-passage editing
- Vitest and Testing Library

Core files: [`src/lib/analyzer.ts`](src/lib/analyzer.ts), [`src/lib/statistical-features.ts`](src/lib/statistical-features.ts), [`src/lib/document.ts`](src/lib/document.ts), [`src/lib/revision.ts`](src/lib/revision.ts), and [`src/lib/export-report.ts`](src/lib/export-report.ts).

## License

MIT
