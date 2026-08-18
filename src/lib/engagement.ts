export type EngagementSnapshot = {
  activeSeconds: number
  highestProgress: number
  secondSampleOpened: boolean
  meaningfulRecorded: boolean
}

export const initialEngagement: EngagementSnapshot = {
  activeSeconds: 0,
  highestProgress: 0,
  secondSampleOpened: false,
  meaningfulRecorded: false,
}

export function isMeaningfullyEngaged(snapshot: EngagementSnapshot): boolean {
  return (
    snapshot.activeSeconds >= 10 &&
    (snapshot.highestProgress >= 50 || snapshot.secondSampleOpened)
  )
}

export function shouldRecordMeaningfulEngagement(
  snapshot: EngagementSnapshot,
): boolean {
  return !snapshot.meaningfulRecorded && isMeaningfullyEngaged(snapshot)
}

export function isFeedbackProminent(snapshot: EngagementSnapshot): boolean {
  return (
    snapshot.activeSeconds >= 10 ||
    snapshot.highestProgress >= 50 ||
    snapshot.secondSampleOpened
  )
}
