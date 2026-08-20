import { describe, expect, it } from 'vitest'
import {
  getDelayMultiplier,
  getOrpIndex,
  getProgressPercent,
  getSentenceRanges,
  tokenize,
} from './reader'

describe('RSVP reader logic', () => {
  it('tokenizes whitespace without producing empty words', () => {
    expect(tokenize('  Read   this\nquickly. ').map((token) => token.raw)).toEqual([
      'Read',
      'this',
      'quickly.',
    ])
  })

  it('places the ORP near the beginning of each word', () => {
    expect(getOrpIndex('I')).toBe(0)
    expect(getOrpIndex('read')).toBe(1)
    expect(getOrpIndex('reading')).toBe(2)
    expect(getOrpIndex('extraordinary')).toBe(3)
  })

  it('adds pacing at clauses and sentence endings', () => {
    expect(getDelayMultiplier('pause,')).toBe(1.5)
    expect(getDelayMultiplier('stop.')).toBe(2)
    expect(getDelayMultiplier('thought—')).toBe(1.5)
    expect(getDelayMultiplier('plain')).toBe(1)
  })

  it('reports progress from completed words and clamps its result', () => {
    expect(getProgressPercent(0, 10)).toBe(0)
    expect(getProgressPercent(5, 10)).toBe(50)
    expect(getProgressPercent(10, 10)).toBe(100)
    expect(getProgressPercent(11, 10)).toBe(100)
    expect(getProgressPercent(1, 0)).toBe(0)
  })

  it('groups tokens into complete sentences and retains a trailing fragment', () => {
    const tokens = tokenize('One short sentence. Is this another? A trailing fragment')

    expect(getSentenceRanges(tokens)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
    ])
    expect(getSentenceRanges([])).toEqual([])
  })
})
