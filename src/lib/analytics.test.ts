import { describe, expect, it } from 'vitest'
import { addDedupeKey } from './analytics'

describe('analytics event deduplication', () => {
  it('adds an unseen key and rejects a repeated key', () => {
    const first = addDedupeKey([], 'engagement_10s')
    const duplicate = addDedupeKey(first.keys, 'engagement_10s')

    expect(first).toEqual({ added: true, keys: ['engagement_10s'] })
    expect(duplicate).toEqual({
      added: false,
      keys: ['engagement_10s'],
    })
  })

  it('keeps the newest bounded set of keys', () => {
    expect(addDedupeKey(['one', 'two'], 'three', 2).keys).toEqual([
      'two',
      'three',
    ])
  })
})
