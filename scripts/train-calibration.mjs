/* global console, process */

import { build } from 'esbuild'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')
const CORPUS_DIR = resolve(
  PROJECT_ROOT,
  process.argv[2] ?? '../tmp/research/ghostbuster-data/essay',
)
const OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  'src/data/calibration-profile.ts',
)

const HUMAN_FAMILY = 'human'
const AI_FAMILIES = [
  'claude',
  'gpt',
  'gpt_prompt1',
  'gpt_prompt2',
  'gpt_semantic',
  'gpt_writing',
]
const ALL_FAMILIES = [HUMAN_FAMILY, ...AI_FAMILIES]
const REGULARIZATION = 0.02
const EPOCHS = 450
const LEARNING_RATE = 0.035
const HUMAN_DOCUMENT_FALSE_POSITIVE_TARGET = 0.01
const REPORTING_FLOOR = 0.2
const DOMAIN_SUPPORT_QUANTILE = 0.995
const LONG_WORD_MINIMUM_CHARACTERS = 10
const LEXICAL_DOMAIN_FEATURES = [
  'meanWordLength',
  'stopwordRatio',
  'nominalizationRatio',
]

function stableBucket(id) {
  let hash = 2166136261
  for (const character of `essay:${id}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 20
}

function splitForId(id) {
  const bucket = stableBucket(id)
  if (bucket < 14) return 'train'
  if (bucket < 17) return 'validation'
  return 'test'
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))))
}

function dot(left, right) {
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0
}

function round(value) {
  return Number(value.toFixed(6))
}

function quantile(values, probability) {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor((ordered.length - 1) * probability)]
}

async function loadFeatureModule() {
  const temporaryDirectory = await mkdtemp(
    join(resolve(tmpdir()), 'draftlens-calibration-'),
  )
  const bundledPath = join(temporaryDirectory, 'statistical-features.mjs')
  await build({
    entryPoints: [resolve(PROJECT_ROOT, 'src/lib/statistical-features.ts')],
    outfile: bundledPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const module = await import(pathToFileURL(bundledPath).href)
  await rm(temporaryDirectory, { recursive: true, force: true })
  return module
}

async function loadDocuments(featureModule) {
  const documents = []
  for (const family of ALL_FAMILIES) {
    const directory = join(CORPUS_DIR, family)
    const filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith('.txt'))
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))

    for (const filename of filenames) {
      const id = filename.slice(0, -4)
      const text = await readFile(join(directory, filename), 'utf8')
      const sentences = featureModule.splitStatisticalSentences(text)
      const ranges = featureModule.createStatisticalWindowRanges(
        sentences.length,
        7,
        3,
        5,
      )
      if (ranges.length === 0) continue

      documents.push({
        id,
        family,
        label: family === HUMAN_FAMILY ? 0 : 1,
        split: splitForId(id),
        sentenceWordCounts: sentences.map((sentence) =>
          featureModule.countStatisticalWords(sentence),
        ),
        writingCharacteristics: featureModule.extractWritingCharacteristics(
          text,
          LONG_WORD_MINIMUM_CHARACTERS,
        ),
        windows: ranges.map(({ start, end }) => ({
          start,
          end,
          features: featureModule.extractStatisticalFeatures(
            sentences.slice(start, end).join(' '),
          ),
        })),
      })
    }
  }
  return documents
}

function trainingRows(documents, featureNames) {
  const trainingDocuments = documents.filter((document) => document.split === 'train')
  const humanCount = trainingDocuments.filter((document) => document.label === 0).length
  const aiCount = trainingDocuments.filter((document) => document.label === 1).length
  const rows = []

  trainingDocuments.forEach((document) => {
    const classDocumentCount = document.label === 0 ? humanCount : aiCount
    const weight = 0.5 / classDocumentCount / document.windows.length
    document.windows.forEach((window) => {
      rows.push({
        label: document.label,
        weight,
        raw: featureNames.map((name) => window.features[name]),
      })
    })
  })
  return rows
}

function standardize(rows, featureCount) {
  const means = Array(featureCount).fill(0)
  rows.forEach((row) => {
    row.raw.forEach((value, index) => {
      means[index] += value * row.weight
    })
  })

  const scales = Array(featureCount).fill(0)
  rows.forEach((row) => {
    row.raw.forEach((value, index) => {
      scales[index] += (value - means[index]) ** 2 * row.weight
    })
  })
  scales.forEach((value, index) => {
    scales[index] = Math.max(Math.sqrt(value), 1e-6)
  })

  rows.forEach((row) => {
    row.values = row.raw.map(
      (value, index) => (value - means[index]) / scales[index],
    )
  })
  return { means, scales }
}

function trainLogisticRegression(rows, featureCount) {
  const coefficients = Array(featureCount).fill(0)
  const firstMoment = Array(featureCount).fill(0)
  const secondMoment = Array(featureCount).fill(0)
  let intercept = 0
  let interceptFirstMoment = 0
  let interceptSecondMoment = 0

  for (let epoch = 1; epoch <= EPOCHS; epoch += 1) {
    const coefficientGradient = coefficients.map(
      (coefficient) => REGULARIZATION * coefficient,
    )
    let interceptGradient = 0

    rows.forEach((row) => {
      const error =
        (sigmoid(intercept + dot(coefficients, row.values)) - row.label) *
        row.weight
      interceptGradient += error
      row.values.forEach((value, index) => {
        coefficientGradient[index] += error * value
      })
    })

    const beta1Correction = 1 - 0.9 ** epoch
    const beta2Correction = 1 - 0.999 ** epoch
    coefficients.forEach((coefficient, index) => {
      firstMoment[index] = 0.9 * firstMoment[index] + 0.1 * coefficientGradient[index]
      secondMoment[index] =
        0.999 * secondMoment[index] +
        0.001 * coefficientGradient[index] ** 2
      coefficients[index] =
        coefficient -
        (LEARNING_RATE * firstMoment[index]) /
          beta1Correction /
          (Math.sqrt(secondMoment[index] / beta2Correction) + 1e-8)
    })

    interceptFirstMoment =
      0.9 * interceptFirstMoment + 0.1 * interceptGradient
    interceptSecondMoment =
      0.999 * interceptSecondMoment + 0.001 * interceptGradient ** 2
    intercept -=
      (LEARNING_RATE * interceptFirstMoment) /
      beta1Correction /
      (Math.sqrt(interceptSecondMoment / beta2Correction) + 1e-8)
  }

  return { coefficients, intercept }
}

function attachProbabilities(
  documents,
  featureNames,
  means,
  scales,
  coefficients,
  intercept,
) {
  documents.forEach((document) => {
    document.windows.forEach((window) => {
      const standardized = featureNames.map(
        (name, index) => (window.features[name] - means[index]) / scales[index],
      )
      window.probability = sigmoid(intercept + dot(coefficients, standardized))
    })
  })
}

function documentDomainMetrics(
  document,
  featureNames,
  means,
  scales,
  coefficients,
) {
  const meanContributions = featureNames.map(() => 0)
  document.windows.forEach((window) => {
    featureNames.forEach((name, index) => {
      meanContributions[index] +=
        (((window.features[name] - means[index]) / scales[index]) *
          coefficients[index]) /
        document.windows.length
    })
  })
  const positiveContributionTotal = meanContributions.reduce(
    (total, contribution) => total + Math.max(0, contribution),
    0,
  )
  const lexicalContribution = LEXICAL_DOMAIN_FEATURES.reduce(
    (total, name) =>
      total +
      Math.max(0, meanContributions[featureNames.indexOf(name)]),
    0,
  )

  return {
    longWordRatio: document.writingCharacteristics.longWordRatio,
    lexicalContributionShare: rate(
      lexicalContribution,
      positiveContributionTotal,
    ),
  }
}

function buildDomainSupport(
  documents,
  featureNames,
  means,
  scales,
  coefficients,
) {
  const metrics = new Map(
    documents.map((document) => [
      document,
      documentDomainMetrics(
        document,
        featureNames,
        means,
        scales,
        coefficients,
      ),
    ]),
  )
  const trainingMetrics = documents
    .filter((document) => document.split === 'train')
    .map((document) => metrics.get(document))
  const longWordRatioUpperBound = quantile(
    trainingMetrics.map((metric) => metric.longWordRatio),
    DOMAIN_SUPPORT_QUANTILE,
  )
  const lexicalContributionShareUpperBound = quantile(
    trainingMetrics.map((metric) => metric.lexicalContributionShare),
    DOMAIN_SUPPORT_QUANTILE,
  )
  const isUnsupported = (metric) =>
    metric.longWordRatio > longWordRatioUpperBound &&
    metric.lexicalContributionShare > lexicalContributionShareUpperBound
  const unsupportedRate = (split) => {
    const selected = documents.filter((document) => document.split === split)
    return rate(
      selected.filter((document) => isUnsupported(metrics.get(document))).length,
      selected.length,
    )
  }

  return {
    method: 'joint-upper-tail',
    calibrationQuantile: DOMAIN_SUPPORT_QUANTILE,
    longWordMinimumCharacters: LONG_WORD_MINIMUM_CHARACTERS,
    longWordRatioUpperBound,
    lexicalContributionShareUpperBound,
    lexicalFeatureNames: LEXICAL_DOMAIN_FEATURES,
    trainingUnsupportedDocumentRate: unsupportedRate('train'),
    validationUnsupportedDocumentRate: unsupportedRate('validation'),
  }
}

function documentRates(documents, split, threshold) {
  const selected = documents.filter((document) => document.split === split)
  const human = selected.filter((document) => document.label === 0)
  const ai = selected.filter((document) => document.label === 1)
  const isReported = (document) => {
    const probabilitySums = document.sentenceWordCounts.map(() => 0)
    const windowCounts = document.sentenceWordCounts.map(() => 0)
    document.windows.forEach((window) => {
      for (let index = window.start; index < window.end; index += 1) {
        probabilitySums[index] += window.probability
        windowCounts[index] += 1
      }
    })
    const totalWords = document.sentenceWordCounts.reduce(
      (sum, wordCount) => sum + wordCount,
      0,
    )
    const detectedWords = document.sentenceWordCounts.reduce(
      (sum, wordCount, index) =>
        sum +
        (windowCounts[index] > 0 &&
        probabilitySums[index] / windowCounts[index] >= threshold
          ? wordCount
          : 0),
      0,
    )
    return rate(detectedWords, totalWords) >= REPORTING_FLOOR
  }

  return {
    humanFalsePositiveRate: rate(human.filter(isReported).length, human.length),
    aiRecall: rate(ai.filter(isReported).length, ai.length),
  }
}

function chooseThreshold(documents) {
  const probabilities = documents
    .filter((document) => document.split === 'validation')
    .flatMap((document) => document.windows.map((window) => window.probability))
  const candidates = [...new Set([0.5, ...probabilities, 1])]
    .filter((value) => value >= 0.5)
    .sort((left, right) => left - right)

  for (const threshold of candidates) {
    const metrics = documentRates(documents, 'validation', threshold)
    if (
      metrics.humanFalsePositiveRate <= HUMAN_DOCUMENT_FALSE_POSITIVE_TARGET
    ) {
      return { threshold, ...metrics }
    }
  }
  return {
    threshold: 1,
    ...documentRates(documents, 'validation', 1),
  }
}

function windowMetrics(documents, split, threshold) {
  const windows = documents
    .filter((document) => document.split === split)
    .flatMap((document) =>
      document.windows.map((window) => ({
        label: document.label,
        probability: window.probability,
      })),
    )
  const human = windows.filter((window) => window.label === 0)
  const ai = windows.filter((window) => window.label === 1)
  const truePositiveRate = rate(
    ai.filter((window) => window.probability >= threshold).length,
    ai.length,
  )
  const trueNegativeRate = rate(
    human.filter((window) => window.probability < threshold).length,
    human.length,
  )

  const ranked = [...windows].sort(
    (left, right) => left.probability - right.probability,
  )
  let rankSum = 0
  for (let start = 0; start < ranked.length; ) {
    let end = start + 1
    while (
      end < ranked.length &&
      ranked[end].probability === ranked[start].probability
    ) {
      end += 1
    }
    const averageRank = (start + 1 + end) / 2
    for (let index = start; index < end; index += 1) {
      if (ranked[index].label === 1) rankSum += averageRank
    }
    start = end
  }
  const rocAuc =
    (rankSum - (ai.length * (ai.length + 1)) / 2) /
    (ai.length * human.length)

  return {
    rocAuc,
    balancedAccuracy: (truePositiveRate + trueNegativeRate) / 2,
  }
}

function vectorSource(featureNames, values) {
  return `{
${featureNames
  .map((name, index) => `    ${name}: ${round(values[index])},`)
  .join('\n')}
  }`
}

function generatedProfileSource({
  featureNames,
  means,
  scales,
  coefficients,
  intercept,
  threshold,
  domainSupport,
  documentCounts,
  validationMetrics,
  testDocumentMetrics,
  testWindowMetrics,
}) {
  return `import type { StatisticalCalibrationProfile } from '../lib/statistical-features'

/**
 * Generated by scripts/train-calibration.mjs from the CC BY 3.0 Ghostbuster
 * essay corpus. No source essays are bundled into the application.
 */
export const CALIBRATION_PROFILE = {
  id: 'ghostbuster-essay-logistic',
  version: 'ghostbuster-essay-v3-domain-gated',
  model: 'standardized-logistic-regression',
  featureNames: ${JSON.stringify(featureNames, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')},
  means: ${vectorSource(featureNames, means)},
  scales: ${vectorSource(featureNames, scales)},
  coefficients: ${vectorSource(featureNames, coefficients)},
  intercept: ${round(intercept)},
  detectionThreshold: ${round(threshold)},
  domainSupport: {
    method: 'joint-upper-tail',
    calibrationQuantile: ${domainSupport.calibrationQuantile},
    longWordMinimumCharacters: ${domainSupport.longWordMinimumCharacters},
    longWordRatioUpperBound: ${round(domainSupport.longWordRatioUpperBound)},
    lexicalContributionShareUpperBound: ${round(domainSupport.lexicalContributionShareUpperBound)},
    lexicalFeatureNames: ${JSON.stringify(domainSupport.lexicalFeatureNames)},
    trainingUnsupportedDocumentRate: ${round(domainSupport.trainingUnsupportedDocumentRate)},
    validationUnsupportedDocumentRate: ${round(domainSupport.validationUnsupportedDocumentRate)},
  },
  source: {
    name: 'Ghostbuster essay corpus',
    url: 'https://github.com/vivek3141/ghostbuster-data',
    license: 'CC BY 3.0',
    revision: '86ebd72590556a81622986fab736ab9227a948af',
  },
  training: {
    windowSentences: '5-7 sentences; target 7, stride 3, end-aligned final window',
    split: 'Prompt/file IDs grouped by FNV-1a hash: 70% train, 15% validation, 15% test',
    humanFamily: 'human',
    aiFamilies: ${JSON.stringify(AI_FAMILIES)},
    regularization: ${REGULARIZATION},
  },
  validation: {
    trainDocuments: ${documentCounts.train},
    validationDocuments: ${documentCounts.validation},
    testDocuments: ${documentCounts.test},
    validationHumanDocumentFalsePositiveRate: ${round(validationMetrics.humanFalsePositiveRate)},
    validationAiDocumentRecall: ${round(validationMetrics.aiRecall)},
    testHumanDocumentFalsePositiveRate: ${round(testDocumentMetrics.humanFalsePositiveRate)},
    testAiDocumentRecall: ${round(testDocumentMetrics.aiRecall)},
    testWindowRocAuc: ${round(testWindowMetrics.rocAuc)},
    testWindowBalancedAccuracy: ${round(testWindowMetrics.balancedAccuracy)},
  },
} satisfies StatisticalCalibrationProfile
`
}

async function main() {
  const featureModule = await loadFeatureModule()
  const featureNames = [...featureModule.STATISTICAL_FEATURE_NAMES]
  const documents = await loadDocuments(featureModule)
  const rows = trainingRows(documents, featureNames)
  const { means, scales } = standardize(rows, featureNames.length)
  const { coefficients, intercept } = trainLogisticRegression(
    rows,
    featureNames.length,
  )
  attachProbabilities(
    documents,
    featureNames,
    means,
    scales,
    coefficients,
    intercept,
  )
  const domainSupport = buildDomainSupport(
    documents,
    featureNames,
    means,
    scales,
    coefficients,
  )

  const validationMetrics = chooseThreshold(documents)
  const testDocumentMetrics = documentRates(
    documents,
    'test',
    validationMetrics.threshold,
  )
  const testWindowMetrics = windowMetrics(
    documents,
    'test',
    validationMetrics.threshold,
  )
  const documentCounts = Object.fromEntries(
    ['train', 'validation', 'test'].map((split) => [
      split,
      documents.filter((document) => document.split === split).length,
    ]),
  )

  await writeFile(
    OUTPUT_PATH,
    generatedProfileSource({
      featureNames,
      means,
      scales,
      coefficients,
      intercept,
      threshold: validationMetrics.threshold,
      domainSupport,
      documentCounts,
      validationMetrics,
      testDocumentMetrics,
      testWindowMetrics,
    }),
    'utf8',
  )

  console.log(
    JSON.stringify(
      {
        corpus: CORPUS_DIR,
        documents: documentCounts,
        windows: rows.length,
        detectionThreshold: round(validationMetrics.threshold),
        domainSupport: {
          longWordRatioUpperBound: round(
            domainSupport.longWordRatioUpperBound,
          ),
          lexicalContributionShareUpperBound: round(
            domainSupport.lexicalContributionShareUpperBound,
          ),
          trainingUnsupportedDocumentRate: round(
            domainSupport.trainingUnsupportedDocumentRate,
          ),
          validationUnsupportedDocumentRate: round(
            domainSupport.validationUnsupportedDocumentRate,
          ),
        },
        validationHumanDocumentFalsePositiveRate: round(
          validationMetrics.humanFalsePositiveRate,
        ),
        validationAiDocumentRecall: round(validationMetrics.aiRecall),
        testHumanDocumentFalsePositiveRate: round(
          testDocumentMetrics.humanFalsePositiveRate,
        ),
        testAiDocumentRecall: round(testDocumentMetrics.aiRecall),
        testWindowRocAuc: round(testWindowMetrics.rocAuc),
        testWindowBalancedAccuracy: round(testWindowMetrics.balancedAccuracy),
        output: OUTPUT_PATH,
      },
      null,
      2,
    ),
  )
}

await main()
