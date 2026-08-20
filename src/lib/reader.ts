export type ReaderToken = {
  raw: string
  prefix: string
  focus: string
  suffix: string
  delayMultiplier: number
}

export type SentenceRange = {
  start: number
  end: number
}

const SENTENCE_END = /[.!?]["'”’)]*$/
const CLAUSE_END = /[,;:—–]["'”’)]*$/

export function tokenize(text: string): ReaderToken[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const letters = Array.from(raw)
      const focusIndex = getOrpIndex(raw)

      return {
        raw,
        prefix: letters.slice(0, focusIndex).join(''),
        focus: letters[focusIndex] ?? '',
        suffix: letters.slice(focusIndex + 1).join(''),
        delayMultiplier: getDelayMultiplier(raw),
      }
    })
}

export function getOrpIndex(word: string): number {
  const length = Array.from(word).length

  if (length <= 1) return 0
  if (length <= 5) return 1
  if (length <= 9) return 2
  if (length <= 13) return 3
  return 4
}

export function getDelayMultiplier(word: string): number {
  if (SENTENCE_END.test(word)) return 2
  if (CLAUSE_END.test(word)) return 1.5
  if (Array.from(word).length > 9) return 1.2
  return 1
}

export function getWordDelayMs(word: ReaderToken, wpm: number): number {
  return (60_000 / wpm) * word.delayMultiplier
}

export function getProgressPercent(completedWords: number, totalWords: number): number {
  if (totalWords <= 0) return 0
  return Math.min(100, Math.max(0, (completedWords / totalWords) * 100))
}

export function getSentenceRanges(tokens: ReaderToken[]): SentenceRange[] {
  const ranges: SentenceRange[] = []
  let start = 0

  tokens.forEach((token, index) => {
    if (!SENTENCE_END.test(token.raw)) return

    ranges.push({ start, end: index + 1 })
    start = index + 1
  })

  if (start < tokens.length) {
    ranges.push({ start, end: tokens.length })
  }

  return ranges
}
