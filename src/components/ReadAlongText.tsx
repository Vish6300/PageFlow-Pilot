import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  getSentenceRanges,
  type ReaderToken,
  type SentenceRange,
} from '../lib/reader'

type ReadAlongTextProps = {
  tokens: ReaderToken[]
  currentIndex: number
  onWordSelect: (index: number) => void
}

function getActiveSentenceIndex(
  sentences: SentenceRange[],
  currentIndex: number,
): number {
  const sentenceIndex = sentences.findIndex(
    ({ start, end }) => currentIndex >= start && currentIndex < end,
  )

  return sentenceIndex === -1 ? 0 : sentenceIndex
}

export function ReadAlongText({
  tokens,
  currentIndex,
  onWordSelect,
}: ReadAlongTextProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentenceRefs = useRef<Array<HTMLSpanElement | null>>([])
  const sentences = useMemo(() => getSentenceRanges(tokens), [tokens])
  const activeSentenceIndex = getActiveSentenceIndex(sentences, currentIndex)

  useEffect(() => {
    const scrollContainer = scrollRef.current
    const activeSentence = sentenceRefs.current[activeSentenceIndex]
    if (!scrollContainer || !activeSentence) return

    if (activeSentenceIndex === 0) {
      scrollContainer.scrollTo({ top: 0, behavior: 'auto' })
      return
    }

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const targetTop = Math.max(
      0,
      activeSentence.offsetTop -
        scrollContainer.clientHeight * 0.34,
    )

    scrollContainer.scrollTo({
      top: targetTop,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }, [activeSentenceIndex, sentences])

  return (
    <div
      ref={scrollRef}
      className="read-along-scroll"
      aria-label="Full sample text. Tap a word to continue from there, or use the left and right arrow keys."
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        onWordSelect(currentIndex + direction)
      }}
    >
      <p className="read-along-text">
        {sentences.map(({ start, end }, sentenceIndex) => (
          <Fragment key={start}>
            <span
              ref={(element) => {
                sentenceRefs.current[sentenceIndex] = element
              }}
              className={
                sentenceIndex === activeSentenceIndex
                  ? 'read-along-sentence read-along-sentence--active'
                  : 'read-along-sentence'
              }
            >
              {tokens.slice(start, end).map((token, offset) => {
                const tokenIndex = start + offset

                return (
                  <span key={tokenIndex}>
                    <button
                      type="button"
                      className={
                        tokenIndex === currentIndex
                          ? 'read-along-word read-along-word--active'
                          : 'read-along-word'
                      }
                      onClick={() => {
                        onWordSelect(tokenIndex)
                        scrollRef.current?.focus({ preventScroll: true })
                      }}
                      tabIndex={tokenIndex === currentIndex ? 0 : -1}
                      aria-label={`Start reading from ${token.raw}`}
                      title={`Start from “${token.raw}”`}
                    >
                      {token.raw}
                    </button>
                    {tokenIndex < tokens.length - 1 ? ' ' : ''}
                  </span>
                )
              })}
            </span>
            {(sentenceIndex + 1) % 3 === 0 &&
            sentenceIndex < sentences.length - 1 ? (
              <span className="read-along-paragraph-break" aria-hidden="true" />
            ) : null}
          </Fragment>
        ))}
      </p>
    </div>
  )
}
