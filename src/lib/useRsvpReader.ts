import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getProgressPercent,
  getWordDelayMs,
  type ReaderToken,
} from './reader'

type ReaderOptions = {
  resetKey: string
  tokens: ReaderToken[]
  wpm: number
  onProgress: (progress: number) => void
  onComplete: () => void
}

export function useRsvpReader({
  resetKey,
  tokens,
  wpm,
  onProgress,
  onComplete,
}: ReaderOptions) {
  const [stateKey, setStateKey] = useState(resetKey)
  const [storedIndex, setIndex] = useState(0)
  const [storedCompletedWords, setCompletedWords] = useState(0)
  const [storedIsPlaying, setIsPlaying] = useState(false)
  const completionCalled = useRef(false)
  const onProgressRef = useRef(onProgress)
  const onCompleteRef = useRef(onComplete)
  const isReset = stateKey !== resetKey
  const index = isReset ? 0 : storedIndex
  const completedWords = isReset ? 0 : storedCompletedWords
  const isPlaying = isReset ? false : storedIsPlaying

  useEffect(() => {
    onProgressRef.current = onProgress
    onCompleteRef.current = onComplete
  }, [onComplete, onProgress])

  const restart = useCallback(() => {
    setStateKey(resetKey)
    setIsPlaying(false)
    setIndex(0)
    setCompletedWords(0)
    completionCalled.current = false
    onProgressRef.current(0)
  }, [resetKey])

  useEffect(() => {
    if (!isPlaying || tokens.length === 0) return

    const timeout = window.setTimeout(() => {
      const nextCompleted = Math.min(index + 1, tokens.length)
      const progress = getProgressPercent(nextCompleted, tokens.length)
      setCompletedWords(nextCompleted)
      onProgressRef.current(progress)

      if (nextCompleted === tokens.length) {
        setIsPlaying(false)
        if (!completionCalled.current) {
          completionCalled.current = true
          onCompleteRef.current()
        }
        return
      }

      setIndex(nextCompleted)
    }, getWordDelayMs(tokens[index], wpm))

    return () => window.clearTimeout(timeout)
  }, [index, isPlaying, tokens, wpm])

  const toggle = useCallback(() => {
    if (isReset || completedWords >= tokens.length) {
      setStateKey(resetKey)
      setIndex(0)
      setCompletedWords(0)
      completionCalled.current = false
      onProgressRef.current(0)
      setIsPlaying(true)
      return
    }

    setIsPlaying((playing) => !playing)
  }, [completedWords, isReset, resetKey, tokens.length])

  return {
    currentToken: tokens[index],
    currentWordNumber: Math.min(index + 1, tokens.length),
    completedWords,
    progress: getProgressPercent(completedWords, tokens.length),
    isPlaying,
    toggle,
    restart,
    pause: () => {
      setStateKey(resetKey)
      setIsPlaying(false)
      if (isReset) {
        setIndex(0)
        setCompletedWords(0)
      }
    },
  }
}
