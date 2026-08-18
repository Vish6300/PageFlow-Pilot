import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { samples } from './content/samples'
import { initialEngagement, isFeedbackProminent, shouldRecordMeaningfulEngagement } from './lib/engagement'
import { PilotAnalytics } from './lib/analytics'
import { LofiAudio } from './lib/audio'
import { tokenize } from './lib/reader'
import { useRsvpReader } from './lib/useRsvpReader'

const INITIAL_SAMPLE_KEY = 'pageflow_pilot_initial_sample'
const MUTE_KEY = 'pageflow_pilot_muted'
const DEFAULT_WPM = 325
const MILESTONES = [25, 50, 75, 100] as const
const mainSiteUrl = (import.meta.env.VITE_MAIN_SITE_URL ?? '').trim()

function getInitialSampleIndex(): number {
  const stored = sessionStorage.getItem(INITIAL_SAMPLE_KEY)
  const parsed = Number(stored)

  if (stored !== null && Number.isInteger(parsed) && samples[parsed]) {
    return parsed
  }

  const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % samples.length
  sessionStorage.setItem(INITIAL_SAMPLE_KEY, String(randomIndex))
  return randomIndex
}

function Logo() {
  return (
    <span className="brand" aria-label="PageFlow">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.75 5.75A2.75 2.75 0 0 1 6.5 3h4.25c.69 0 1.25.56 1.25 1.25V20a3 3 0 0 0-3-3H3.75V5.75Z" />
        <path d="M20.25 5.75A2.75 2.75 0 0 0 17.5 3h-4.25C12.56 3 12 3.56 12 4.25V20a3 3 0 0 1 3-3h5.25V5.75Z" />
      </svg>
      <span>PageFlow</span>
    </span>
  )
}

function MainSiteLink({ strong = false }: { strong?: boolean }) {
  const analytics = useAnalytics()

  if (!mainSiteUrl) {
    return (
      <span
        className={strong ? 'main-link main-link--strong main-link--disabled' : 'main-link main-link--disabled'}
        aria-label="Open full PageFlow (link available after deployment setup)"
        title="Set VITE_MAIN_SITE_URL to enable this link"
      >
        Open full PageFlow <span aria-hidden="true">↗</span>
      </span>
    )
  }

  return (
    <a
      className={strong ? 'main-link main-link--strong' : 'main-link'}
      href={mainSiteUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => analytics.track('main_site_clicked', { placement: strong ? 'completion' : 'header' })}
    >
      Open full PageFlow <span aria-hidden="true">↗</span>
    </a>
  )
}

const AnalyticsContext = {
  current: null as PilotAnalytics | null,
}

function useAnalytics(): PilotAnalytics {
  if (!AnalyticsContext.current) AnalyticsContext.current = new PilotAnalytics()
  return AnalyticsContext.current
}

function App() {
  const [initialSampleIndex] = useState(getInitialSampleIndex)
  const [sampleIndex, setSampleIndex] = useState(initialSampleIndex)
  const [wpm, setWpm] = useState(DEFAULT_WPM)
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === 'true')
  const [audioError, setAudioError] = useState('')
  const [engagement, setEngagement] = useState(initialEngagement)
  const [completedSample, setCompletedSample] = useState(false)
  const [vote, setVote] = useState<'like' | 'dislike' | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const seenSamples = useRef(new Set([samples[initialSampleIndex].id]))
  const secondSampleStarted = useRef(false)
  const meaningfulRecorded = useRef(false)
  const feedbackRequestInFlight = useRef(false)
  const speedCommitTimer = useRef<number | null>(null)
  const lastCommittedWpm = useRef(DEFAULT_WPM)
  const audio = useRef(new LofiAudio())
  const analytics = useAnalytics()
  const sample = samples[sampleIndex]
  const tokens = useMemo(() => tokenize(sample.text), [sample.text])

  const handleProgress = useCallback((progress: number) => {
    setEngagement((current) => ({
      ...current,
      highestProgress: Math.max(current.highestProgress, progress),
    }))

    MILESTONES.forEach((milestone) => {
      if (progress >= milestone) {
        analytics.trackOnce(`progress_${sample.id}_${milestone}`, `progress_${milestone}`, {
          sample_id: sample.id,
          topic: sample.topic,
          wpm,
        })
      }
    })
  }, [analytics, sample.id, sample.topic, wpm])

  const handleComplete = useCallback(() => {
    setCompletedSample(true)
    audio.current.pause()
  }, [])

  const reader = useRsvpReader({
    resetKey: sample.id,
    tokens,
    wpm,
    onProgress: handleProgress,
    onComplete: handleComplete,
  })

  useEffect(() => {
    void analytics.initialize(sample.id).then(() => {
      analytics.trackOnce('page_view', 'page_view', {
        initial_sample_id: sample.id,
        initial_topic: sample.topic,
      })
    })
  }, [analytics, sample.id, sample.topic])

  useEffect(() => {
    if (!reader.isPlaying) return

    const timer = window.setInterval(() => {
      setEngagement((current) => ({
        ...current,
        activeSeconds: current.activeSeconds + 1,
      }))
    }, 1_000)

    return () => window.clearInterval(timer)
  }, [reader.isPlaying])

  useEffect(() => {
    if (engagement.activeSeconds >= 10) {
      analytics.trackOnce('engagement_10s', 'engagement_10s', {
        sample_id: sample.id,
        elapsed_active_seconds: engagement.activeSeconds,
        highest_progress: Math.round(engagement.highestProgress),
      })
    }

    if (
      !meaningfulRecorded.current &&
      shouldRecordMeaningfulEngagement(engagement)
    ) {
      meaningfulRecorded.current = true
      analytics.trackOnce('meaningful_engagement', 'meaningful_engagement', {
        sample_id: sample.id,
        elapsed_active_seconds: engagement.activeSeconds,
        highest_progress: Math.round(engagement.highestProgress),
        second_sample_opened: engagement.secondSampleOpened,
      })
    }
  }, [analytics, engagement, sample.id])

  useEffect(() => {
    audio.current.setMuted(muted)
    localStorage.setItem(MUTE_KEY, String(muted))
  }, [muted])

  useEffect(() => {
    const player = audio.current
    return () => {
      player.dispose()
      if (speedCommitTimer.current !== null) {
        window.clearTimeout(speedCommitTimer.current)
      }
    }
  }, [])

  const handlePlaybackToggle = () => {
    if (reader.isPlaying) {
      reader.toggle()
      audio.current.pause()
      return
    }

    setCompletedSample(false)
    setAudioError('')

    void audio.current
      .start()
      .then(() => audio.current.setMuted(muted))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Music could not start.'
        setAudioError(`${message} Reading still works normally.`)
      })

    analytics.trackOnce(`play_started_${sample.id}`, 'play_started', {
      sample_id: sample.id,
      topic: sample.topic,
      wpm,
    })

    if (seenSamples.current.size > 1 && !secondSampleStarted.current) {
      secondSampleStarted.current = true
      analytics.trackOnce('second_sample_started', 'second_sample_started', {
        sample_id: sample.id,
        topic: sample.topic,
        elapsed_active_seconds: engagement.activeSeconds,
      })
    }

    reader.toggle()
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        event.code !== 'Space' ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement ||
        target instanceof HTMLAnchorElement
      ) {
        return
      }

      event.preventDefault()
      handlePlaybackToggle()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleRestart = () => {
    reader.restart()
    audio.current.pause()
    setCompletedSample(false)
  }

  const handleSampleSelect = (nextIndex: number) => {
    if (nextIndex === sampleIndex || feedbackRequestInFlight.current) return

    reader.pause()
    audio.current.pause()
    setSampleIndex(nextIndex)
    setCompletedSample(false)
    const nextSample = samples[nextIndex]
    const isSecondSample = !seenSamples.current.has(nextSample.id) && seenSamples.current.size >= 1
    seenSamples.current.add(nextSample.id)

    if (isSecondSample) {
      setEngagement((current) => ({ ...current, secondSampleOpened: true }))
    }

    analytics.track('sample_selected', {
      sample_id: nextSample.id,
      topic: nextSample.topic,
      previous_sample_id: sample.id,
      elapsed_active_seconds: engagement.activeSeconds,
    })
  }

  const handleMute = () => {
    const nextMuted = !muted
    setMuted(nextMuted)
    analytics.track('music_toggled', {
      muted: nextMuted,
      sample_id: sample.id,
      elapsed_active_seconds: engagement.activeSeconds,
    })
    if (!nextMuted && reader.isPlaying) {
      void audio.current.start().catch((error: unknown) => {
        setAudioError(error instanceof Error ? error.message : 'Music could not start.')
      })
    }
  }

  const handleVote = (nextVote: 'like' | 'dislike') => {
    if (feedbackRequestInFlight.current) return
    setVote(nextVote)
    setFeedbackState('idle')
  }

  const handleSpeedChange = (nextWpm: number) => {
    setWpm(nextWpm)
    if (speedCommitTimer.current !== null) {
      window.clearTimeout(speedCommitTimer.current)
    }

    speedCommitTimer.current = window.setTimeout(() => {
      if (nextWpm === lastCommittedWpm.current) {
        speedCommitTimer.current = null
        return
      }

      lastCommittedWpm.current = nextWpm
      analytics.track('speed_changed', {
        sample_id: sample.id,
        wpm: nextWpm,
        elapsed_active_seconds: engagement.activeSeconds,
      })
      speedCommitTimer.current = null
    }, 700)
  }

  const handleFeedbackSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!vote || feedbackRequestInFlight.current) return

    feedbackRequestInFlight.current = true
    setFeedbackState('sending')
    try {
      await analytics.submitFeedback({
        vote,
        suggestion: suggestion.trim() || null,
        sampleId: sample.id,
      })
      setFeedbackState('success')
    } catch (error) {
      console.warn('PageFlow feedback submission failed.', error)
      setFeedbackState('error')
    } finally {
      feedbackRequestInFlight.current = false
    }
  }

  const feedbackProminent = isFeedbackProminent(engagement)
  const ctaStrong = completedSample || feedbackState === 'success'

  return (
    <div className="app-shell">
      <header className="site-header">
        <Logo />
        <MainSiteLink />
      </header>

      <main>
        <section className="intro" aria-labelledby="intro-title">
          <p className="kicker">A faster way through your reading list</p>
          <h1 id="intro-title">Read this story in under a minute.</h1>
          <p>Press play. Keep your eyes on the indigo letter.</p>
        </section>

        <nav className="topics" aria-label="Choose a reading sample">
          {samples.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === sampleIndex ? 'topic-card topic-card--active' : 'topic-card'}
              aria-pressed={index === sampleIndex}
              aria-label={`${item.topic}: ${item.title}`}
              disabled={feedbackState === 'sending'}
              onClick={() => handleSampleSelect(index)}
            >
              <span>{item.topic}</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </nav>

        <section
          className="reader-section"
          aria-labelledby="sample-title"
          aria-describedby={`sample-transcript-${sample.id}`}
        >
          <div className="story-heading">
            <div>
              <p>{sample.eyebrow}</p>
              <h2 id="sample-title">{sample.title}</h2>
            </div>
            <span>{tokens.length} words</span>
          </div>
          <p id={`sample-transcript-${sample.id}`} className="sr-only">
            Full sample transcript: {sample.text}
          </p>

          <div className={reader.isPlaying ? 'reader-stage reader-stage--playing' : 'reader-stage'}>
            <div className="reader-guide reader-guide--top" aria-hidden="true" />
            <div className="reader-word" aria-live="off" aria-label={reader.currentToken?.raw}>
              <span className="word-prefix">{reader.currentToken?.prefix}</span>
              <span className="word-focus">{reader.currentToken?.focus}</span>
              <span className="word-suffix">{reader.currentToken?.suffix}</span>
            </div>
            <div className="reader-guide reader-guide--bottom" aria-hidden="true" />
            <p className="reader-position" aria-hidden="true">
              {reader.currentWordNumber} / {tokens.length}
            </p>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(reader.progress)}
          >
            <span style={{ width: `${reader.progress}%` }} />
          </div>
          <p className="sr-only" aria-live="polite">
            {reader.isPlaying
              ? `Reading at ${wpm} words per minute, ${Math.round(reader.progress)} percent complete.`
              : completedSample
                ? 'Sample complete.'
                : `Paused at ${Math.round(reader.progress)} percent.`}
          </p>

          <div className="controls">
            <button
              type="button"
              className="icon-button"
              onClick={handleRestart}
              aria-label="Restart sample"
              title="Restart"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            <button
              type="button"
              className="play-button"
              onClick={handlePlaybackToggle}
              aria-label={reader.isPlaying ? 'Pause reading' : completedSample ? 'Read again' : 'Play reading'}
            >
              {reader.isPlaying ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5v14M15 5v14" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 6 9 6-9 6V6Z" />
                </svg>
              )}
              <span>{reader.isPlaying ? 'Pause' : completedSample ? 'Read again' : 'Play'}</span>
            </button>

            <button
              type="button"
              className={muted ? 'mute-button mute-button--muted' : 'mute-button'}
              onClick={handleMute}
              aria-pressed={muted}
              aria-label={muted ? 'Turn music on' : 'Mute music'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z" />
                {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15 9.5c1.5 1.4 1.5 3.6 0 5M18 7c3 2.8 3 7.2 0 10" />}
              </svg>
              <span>{muted ? 'Music off' : 'Music on'}</span>
            </button>
          </div>

          <label className="speed-control">
            <span>Speed</span>
            <input
              type="range"
              min="180"
              max="600"
              step="5"
              value={wpm}
              onChange={(event) => handleSpeedChange(Number(event.target.value))}
              aria-describedby="speed-value"
            />
            <output id="speed-value">{wpm} WPM</output>
          </label>

          {audioError && <p className="audio-notice" role="status">{audioError}</p>}
          <p className="keyboard-hint">Tip: press Space to play or pause.</p>
        </section>

        <section className={feedbackProminent ? 'feedback feedback--prominent' : 'feedback'} aria-labelledby="feedback-title">
          <div>
            <p className="kicker">One-tap feedback</p>
            <h2 id="feedback-title">Did this feel useful?</h2>
          </div>
          <div className="vote-buttons" aria-label="Rate the experience">
            <button
              type="button"
              className={vote === 'like' ? 'vote-button vote-button--selected' : 'vote-button'}
              aria-pressed={vote === 'like'}
              disabled={feedbackState === 'sending'}
              onClick={() => handleVote('like')}
            >
              <span aria-hidden="true">↑</span> Yes
            </button>
            <button
              type="button"
              className={vote === 'dislike' ? 'vote-button vote-button--selected' : 'vote-button'}
              aria-pressed={vote === 'dislike'}
              disabled={feedbackState === 'sending'}
              onClick={() => handleVote('dislike')}
            >
              <span aria-hidden="true">↓</span> Not yet
            </button>
          </div>

          {vote && (
            <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
              <label htmlFor="suggestion">What would make it better? <span>(optional)</span></label>
              <textarea
                id="suggestion"
                value={suggestion}
                maxLength={500}
                rows={3}
                disabled={feedbackState === 'sending'}
                placeholder="A short suggestion..."
                onChange={(event) => {
                  setSuggestion(event.target.value)
                  setFeedbackState('idle')
                }}
              />
              <div className="feedback-submit-row">
                <button type="submit" disabled={feedbackState === 'sending'}>
                  {feedbackState === 'sending' ? 'Sending…' : feedbackState === 'success' ? 'Update feedback' : 'Submit'}
                </button>
                <p className="privacy-note">
                  Anonymous only. No account, name, email, or reading text is collected.
                </p>
              </div>
              {feedbackState === 'success' && (
                <p className="feedback-status feedback-status--success" role="status">
                  Thank you—your feedback was saved. You can update it anytime.
                </p>
              )}
              {feedbackState === 'error' && (
                <p className="feedback-status feedback-status--error" role="alert">
                  Feedback could not be saved. Check your connection and try again.
                </p>
              )}
            </form>
          )}
        </section>

        <section className={ctaStrong ? 'final-cta final-cta--strong' : 'final-cta'}>
          <div>
            <p className="kicker">{completedSample ? 'Nice work' : 'Keep the momentum'}</p>
            <h2>{completedSample ? 'You just finished what you started.' : 'Turn saved articles into finished articles.'}</h2>
          </div>
          <MainSiteLink strong />
        </section>
      </main>

      <footer>
        <Logo />
        <p>Finish what you save.</p>
      </footer>
    </div>
  )
}

export default App
