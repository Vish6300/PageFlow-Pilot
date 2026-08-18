export type PilotEventName =
  | 'page_view'
  | 'play_started'
  | 'engagement_10s'
  | 'progress_25'
  | 'progress_50'
  | 'progress_75'
  | 'progress_100'
  | 'sample_selected'
  | 'second_sample_started'
  | 'speed_changed'
  | 'music_toggled'
  | 'vote_submitted'
  | 'suggestion_submitted'
  | 'main_site_clicked'
  | 'meaningful_engagement'

type EventProperties = Record<string, boolean | number | string | null>
type RpcBody = Record<string, unknown>

type QueuedEvent = {
  event_id: string
  event_name: PilotEventName
  occurred_at: string
  properties: EventProperties
}

type FeedbackInput = {
  vote: 'like' | 'dislike'
  suggestion: string | null
  sampleId: string
}

const SESSION_KEY = 'pageflow_pilot_session'
const QUEUE_KEY = 'pageflow_pilot_event_queue'
const ONCE_KEY = 'pageflow_pilot_once_events'
const MAX_QUEUE_SIZE = 50
const SESSION_MAX_AGE_MS = 29 * 24 * 60 * 60 * 1_000

class AnalyticsRpcError extends Error {
  readonly status: number
  readonly responseBody: string

  constructor(status: number, responseBody: string) {
    super(`Analytics request failed (${status}).`)
    this.status = status
    this.responseBody = responseBody
  }
}

export function addDedupeKey(
  keys: string[],
  nextKey: string,
  limit = 100,
): { added: boolean; keys: string[] } {
  if (keys.includes(nextKey)) return { added: false, keys }
  return { added: true, keys: [...keys, nextKey].slice(-limit) }
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

type PilotIdentity = {
  sessionId: string
  sessionSecret: string
  createdAt: number
}

function createIdentity(): PilotIdentity {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32))
  const identity = {
    sessionId: crypto.randomUUID(),
    sessionSecret: Array.from(secretBytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    createdAt: Date.now(),
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(identity))
  localStorage.removeItem(QUEUE_KEY)
  localStorage.removeItem(ONCE_KEY)
  return identity
}

function getOrCreateIdentity(): PilotIdentity {
  const existing = safeParse<{
    sessionId?: string
    sessionSecret?: string
    createdAt?: number
  }>(localStorage.getItem(SESSION_KEY), {})

  if (
    existing.sessionId &&
    existing.sessionSecret &&
    existing.createdAt &&
    Date.now() - existing.createdAt < SESSION_MAX_AGE_MS
  ) {
    return {
      sessionId: existing.sessionId,
      sessionSecret: existing.sessionSecret,
      createdAt: existing.createdAt,
    }
  }

  return createIdentity()
}

function isCredentialError(error: unknown): error is AnalyticsRpcError {
  return (
    error instanceof AnalyticsRpcError &&
    error.responseBody.includes('Invalid pilot session credentials')
  )
}

function getDeviceCategory(): 'mobile' | 'tablet' | 'desktop' {
  if (window.innerWidth < 640) return 'mobile'
  if (window.innerWidth < 1024) return 'tablet'
  return 'desktop'
}

function getAcquisitionProperties(): EventProperties {
  const params = new URLSearchParams(window.location.search)
  let referrerHost = ''

  if (document.referrer) {
    try {
      referrerHost = new URL(document.referrer).hostname
    } catch {
      referrerHost = ''
    }
  }

  return {
    device: getDeviceCategory(),
    viewport_width: window.innerWidth,
    referrer_host: referrerHost,
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
  }
}

export class PilotAnalytics {
  readonly configured: boolean
  sessionId: string
  private sessionSecret: string
  private readonly supabaseUrl: string
  private readonly anonKey: string
  private flushing = false
  private registered = false
  private initialSampleId = 'unknown'

  constructor() {
    const identity = getOrCreateIdentity()
    this.sessionId = identity.sessionId
    this.sessionSecret = identity.sessionSecret
    this.supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
    this.anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
    this.configured = Boolean(this.supabaseUrl && this.anonKey)

    if (this.configured) {
      window.addEventListener('online', () => void this.initialize(this.initialSampleId))
    }
  }

  async initialize(initialSampleId: string): Promise<void> {
    if (!this.configured) return
    if (this.initialSampleId === 'unknown') this.initialSampleId = initialSampleId

    try {
      await this.register(initialSampleId)
      this.registered = true
      await this.flush()
    } catch (error) {
      if (isCredentialError(error)) {
        this.rotateIdentity()
        try {
          await this.register(initialSampleId)
          this.registered = true
          await this.flush()
          return
        } catch (retryError) {
          console.warn(
            'PageFlow analytics registration failed after rotating the session.',
            retryError,
          )
          return
        }
      }
      console.warn('PageFlow analytics registration failed; retrying later.', error)
    }
  }

  track(
    eventName: PilotEventName,
    properties: EventProperties = {},
  ): void {
    if (!this.configured) return

    const queue = safeParse<QueuedEvent[]>(
      localStorage.getItem(QUEUE_KEY),
      [],
    )
    queue.push({
      event_id: crypto.randomUUID(),
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      properties,
    })
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)),
    )
    if (this.registered) {
      void this.flush()
    } else {
      void this.initialize(this.initialSampleId)
    }
  }

  trackOnce(
    dedupeKey: string,
    eventName: PilotEventName,
    properties: EventProperties = {},
  ): boolean {
    const result = addDedupeKey(
      safeParse<string[]>(localStorage.getItem(ONCE_KEY), []),
      dedupeKey,
    )
    if (!result.added) return false

    localStorage.setItem(ONCE_KEY, JSON.stringify(result.keys))
    this.track(eventName, properties)
    return true
  }

  async submitFeedback({
    vote,
    suggestion,
    sampleId,
  }: FeedbackInput): Promise<void> {
    if (!this.configured) {
      throw new Error('Feedback is unavailable until Supabase is configured.')
    }

    await this.ensureRegistered()
    try {
      await this.sendFeedback({ vote, suggestion, sampleId })
    } catch (error) {
      if (!isCredentialError(error)) throw error
      this.rotateIdentity()
      await this.ensureRegistered()
      await this.sendFeedback({ vote, suggestion, sampleId })
    }

    this.track('vote_submitted', { vote, sample_id: sampleId })
    if (suggestion) {
      this.track('suggestion_submitted', {
        sample_id: sampleId,
        length: suggestion.length,
      })
    }
  }

  private async ensureRegistered(): Promise<void> {
    if (this.registered) return
    await this.initialize(this.initialSampleId)
    if (!this.registered) throw new Error('Unable to start an analytics session.')
  }

  private async flush(): Promise<void> {
    if (!this.configured || !this.registered || this.flushing) return

    const queue = safeParse<QueuedEvent[]>(
      localStorage.getItem(QUEUE_KEY),
      [],
    )
    if (queue.length === 0) return

    this.flushing = true
    try {
      let pending = queue
      while (pending.length > 0) {
        const event = pending[0]
        await this.rpc('record_pilot_event', {
          p_session_id: this.sessionId,
          p_session_secret: this.sessionSecret,
          p_event_id: event.event_id,
          p_event_name: event.event_name,
          p_occurred_at: event.occurred_at,
          p_properties: event.properties,
        })
        const currentQueue = safeParse<QueuedEvent[]>(
          localStorage.getItem(QUEUE_KEY),
          [],
        )
        localStorage.setItem(
          QUEUE_KEY,
          JSON.stringify(
            currentQueue.filter((queued) => queued.event_id !== event.event_id),
          ),
        )
        pending = safeParse<QueuedEvent[]>(
          localStorage.getItem(QUEUE_KEY),
          [],
        )
      }
    } catch (error) {
      if (isCredentialError(error)) {
        this.rotateIdentity()
        void this.initialize(this.initialSampleId)
        console.warn('PageFlow analytics session expired and was rotated.')
        return
      }
      console.warn('PageFlow telemetry send failed; events remain queued.', error)
    } finally {
      this.flushing = false
    }
  }

  private async register(initialSampleId: string): Promise<void> {
    await this.rpc('register_pilot_session', {
      p_session_id: this.sessionId,
      p_session_secret: this.sessionSecret,
      p_initial_sample_id: initialSampleId,
      p_context: getAcquisitionProperties(),
    })
  }

  private async sendFeedback({
    vote,
    suggestion,
    sampleId,
  }: FeedbackInput): Promise<void> {
    await this.rpc('submit_pilot_feedback', {
      p_session_id: this.sessionId,
      p_session_secret: this.sessionSecret,
      p_vote: vote,
      p_suggestion: suggestion,
      p_sample_id: sampleId,
    })
  }

  private rotateIdentity(): void {
    const identity = createIdentity()
    this.sessionId = identity.sessionId
    this.sessionSecret = identity.sessionSecret
    this.registered = false
  }

  private async rpc(name: string, body: RpcBody): Promise<unknown> {
    const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      keepalive: true,
    })

    if (!response.ok) {
      throw new AnalyticsRpcError(response.status, await response.text())
    }

    if (response.status === 204) return null
    const responseBody = await response.text()
    return responseBody ? JSON.parse(responseBody) : null
  }
}
