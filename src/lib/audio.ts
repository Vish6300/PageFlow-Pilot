type WebkitWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

export class LofiAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private timer: number | null = null
  private beat = 0
  private muted = false
  private shouldPlay = false
  private startGeneration = 0
  private activeSources = new Set<AudioScheduledSourceNode>()

  async start(): Promise<void> {
    this.shouldPlay = true
    const generation = ++this.startGeneration
    const AudioContextClass =
      window.AudioContext ?? (window as WebkitWindow).webkitAudioContext

    if (!AudioContextClass) {
      throw new Error('Web Audio is not supported in this browser.')
    }

    if (!this.context) {
      this.context = new AudioContextClass()
      this.master = this.context.createGain()
      this.master.gain.value = this.muted ? 0 : 0.34
      this.master.connect(this.context.destination)
    }

    const context = this.context
    const master = this.master
    if (!context || !master) {
      throw new Error('Music could not be initialized.')
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Music was blocked by the browser.')),
        1_500,
      )

      context.resume().then(
        () => {
          window.clearTimeout(timeout)
          resolve()
        },
        (error: unknown) => {
          window.clearTimeout(timeout)
          reject(error)
        },
      )
    })
    if (!this.shouldPlay || generation !== this.startGeneration) {
      if (!this.shouldPlay) await context.suspend()
      return
    }

    if (this.timer !== null) return

    master.gain.value = this.muted ? 0 : 0.34
    this.playBeat()
    this.timer = window.setInterval(() => this.playBeat(), 1_050)
  }

  pause(): void {
    this.shouldPlay = false
    this.startGeneration += 1
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }

    this.activeSources.forEach((source) => {
      try {
        source.stop()
      } catch {
        // The source may already have ended between scheduling and cleanup.
      }
    })
    this.activeSources.clear()
    if (this.master && this.context) {
      this.master.gain.cancelScheduledValues(this.context.currentTime)
      this.master.gain.value = 0
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!this.context || !this.master) return

    this.master.gain.setTargetAtTime(
      muted ? 0 : 0.34,
      this.context.currentTime,
      0.04,
    )
  }

  dispose(): void {
    this.pause()
    void this.context?.close()
    this.context = null
    this.master = null
  }

  private playBeat(): void {
    if (!this.context || !this.master) return

    const now = this.context.currentTime
    const chordProgression = [
      [220, 261.63, 329.63],
      [196, 246.94, 293.66],
      [174.61, 220, 261.63],
      [196, 246.94, 329.63],
    ]
    const chord = chordProgression[Math.floor(this.beat / 4) % chordProgression.length]

    if (this.beat % 4 === 0) {
      chord.forEach((frequency, index) => {
        this.playTone(frequency, now, 4.15, index === 0 ? 0.026 : 0.015)
      })
    }

    if (this.beat % 2 === 0) {
      this.playTone(chord[0] / 2, now, 0.7, 0.018)
    }

    this.playNoise(now, this.beat % 2 === 0 ? 0.01 : 0.006)
    this.beat += 1
  }

  private playTone(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
  ): void {
    if (!this.context || !this.master) return

    const oscillator = this.context.createOscillator()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()

    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    oscillator.detune.value = -5
    filter.type = 'lowpass'
    filter.frequency.value = 1_100
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.05)
    this.trackSource(oscillator)
  }

  private playNoise(start: number, volume: number): void {
    if (!this.context || !this.master) return

    const length = Math.floor(this.context.sampleRate * 0.035)
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate)
    const data = buffer.getChannelData(0)

    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1
    }

    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()

    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = 1_600
    filter.Q.value = 0.7
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    source.start(start)
    this.trackSource(source)
  }

  private trackSource(source: AudioScheduledSourceNode): void {
    this.activeSources.add(source)
    source.addEventListener('ended', () => this.activeSources.delete(source), {
      once: true,
    })
  }
}
