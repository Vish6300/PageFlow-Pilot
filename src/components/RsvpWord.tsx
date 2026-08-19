import { useId, useLayoutEffect, useRef } from 'react'
import type { ReaderToken } from '../lib/reader'

type RsvpWordProps = {
  token: ReaderToken | undefined
}

export function RsvpWord({ token }: RsvpWordProps) {
  const gradientId = `orp-${useId().replaceAll(':', '')}`
  const svgRef = useRef<SVGSVGElement>(null)
  const textRef = useRef<SVGTextElement>(null)
  const gradientRef = useRef<SVGLinearGradientElement>(null)
  const prefixEndRef = useRef<SVGStopElement>(null)
  const focusStartRef = useRef<SVGStopElement>(null)
  const focusEndRef = useRef<SVGStopElement>(null)
  const suffixStartRef = useRef<SVGStopElement>(null)

  useLayoutEffect(() => {
    const svg = svgRef.current
    const text = textRef.current
    const gradient = gradientRef.current
    if (!svg || !text || !gradient || !token?.raw) return

    let cancelled = false

    const measure = () => {
      if (cancelled || svg.clientWidth === 0) return

      const baseFontSize = Number.parseFloat(getComputedStyle(svg).fontSize)
      text.style.fontSize = `${baseFontSize}px`
      text.setAttribute('x', '0')
      const focusIndex = token.prefix.length
      let wordWidth = text.getComputedTextLength()
      let focusStart = text.getStartPositionOfChar(focusIndex).x
      let focusEnd = text.getEndPositionOfChar(focusIndex).x
      const focusCenter = (focusStart + focusEnd) / 2
      const largestSide = Math.max(focusCenter, wordWidth - focusCenter)
      const availableSide = svg.clientWidth / 2 - 6
      const fitScale = Math.min(1, availableSide / largestSide)

      if (fitScale < 1) {
        text.style.fontSize = `${baseFontSize * fitScale}px`
        wordWidth = text.getComputedTextLength()
        focusStart = text.getStartPositionOfChar(focusIndex).x
        focusEnd = text.getEndPositionOfChar(focusIndex).x
      }

      const translation = svg.clientWidth / 2 - (focusStart + focusEnd) / 2
      const prefixOffset = `${(focusStart / wordWidth) * 100}%`
      const focusOffset = `${(focusEnd / wordWidth) * 100}%`

      text.setAttribute('x', String(translation))
      gradient.setAttribute('x1', String(translation))
      gradient.setAttribute('x2', String(translation + wordWidth))
      prefixEndRef.current?.setAttribute('offset', prefixOffset)
      focusStartRef.current?.setAttribute('offset', prefixOffset)
      focusEndRef.current?.setAttribute('offset', focusOffset)
      suffixStartRef.current?.setAttribute('offset', focusOffset)
      text.style.opacity = '1'
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(svg)
    void document.fonts.ready.then(measure)
    measure()

    return () => {
      cancelled = true
      resizeObserver.disconnect()
    }
  }, [token])

  return (
    <svg
      ref={svgRef}
      className="reader-word"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient
          ref={gradientRef}
          id={gradientId}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a8a29e" />
          <stop ref={prefixEndRef} offset="0%" stopColor="#a8a29e" />
          <stop ref={focusStartRef} offset="0%" stopColor="#4338ca" />
          <stop ref={focusEndRef} offset="100%" stopColor="#4338ca" />
          <stop ref={suffixStartRef} offset="100%" stopColor="#57534e" />
          <stop offset="100%" stopColor="#57534e" />
        </linearGradient>
      </defs>
      <text
        ref={textRef}
        y="50%"
        dominantBaseline="central"
        fill={`url(#${gradientId})`}
      >
        {token?.raw}
      </text>
    </svg>
  )
}
