import { describe, expect, it } from 'vitest'
import {
  getDelayMultiplier,
  getOrpIndex,
  getProgressPercent,
  getReadingLine,
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

  it('keeps an eight-word context line stable until the next block', () => {
    const tokens = tokenize('one two three four five six seven eight nine ten eleven')

    expect(getReadingLine(tokens, 0)).toBe('one two three four five six seven eight')
    expect(getReadingLine(tokens, 7)).toBe('one two three four five six seven eight')
    expect(getReadingLine(tokens, 8)).toBe('nine ten eleven')
  })

  it('keeps configurable context lines between seven and ten words', () => {
    const tokens = tokenize('one two three four five six seven eight nine ten eleven')

    expect(getReadingLine(tokens, 6, 2)).toBe('one two three four five six seven')
    expect(getReadingLine(tokens, 9, 20)).toBe('one two three four five six seven eight nine ten')
  })
})
