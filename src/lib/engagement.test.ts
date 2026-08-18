import { describe, expect, it } from 'vitest'
import {
  isMeaningfullyEngaged,
  shouldRecordMeaningfulEngagement,
  type EngagementSnapshot,
} from './engagement'

function snapshot(
  overrides: Partial<EngagementSnapshot> = {},
): EngagementSnapshot {
  return {
    activeSeconds: 0,
    highestProgress: 0,
    secondSampleOpened: false,
    meaningfulRecorded: false,
    ...overrides,
  }
}

describe('meaningful engagement', () => {
  it('requires ten active seconds plus depth or a second sample', () => {
    expect(
      isMeaningfullyEngaged(snapshot({ activeSeconds: 10, highestProgress: 49 })),
    ).toBe(false)
    expect(
      isMeaningfullyEngaged(snapshot({ activeSeconds: 9, highestProgress: 75 })),
    ).toBe(false)
    expect(
      isMeaningfullyEngaged(snapshot({ activeSeconds: 10, highestProgress: 50 })),
    ).toBe(true)
    expect(
      isMeaningfullyEngaged(
        snapshot({ activeSeconds: 10, secondSampleOpened: true }),
      ),
    ).toBe(true)
  })

  it('records the event only once', () => {
    const engaged = snapshot({ activeSeconds: 12, highestProgress: 60 })
    expect(shouldRecordMeaningfulEngagement(engaged)).toBe(true)
    expect(
      shouldRecordMeaningfulEngagement({
        ...engaged,
        meaningfulRecorded: true,
      }),
    ).toBe(false)
  })
})
