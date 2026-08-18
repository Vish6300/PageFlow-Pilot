import { describe, expect, it } from 'vitest'
import {
  getDelayMultiplier,
  getOrpIndex,
  getProgressPercent,
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
    expect(getDelayMultiplier('stop.')).toBe(2.15)
    expect(getDelayMultiplier('plain')).toBe(1)
  })

  it('reports progress from completed words and clamps its result', () => {
    expect(getProgressPercent(0, 10)).toBe(0)
    expect(getProgressPercent(5, 10)).toBe(50)
    expect(getProgressPercent(10, 10)).toBe(100)
    expect(getProgressPercent(11, 10)).toBe(100)
    expect(getProgressPercent(1, 0)).toBe(0)
  })
})
