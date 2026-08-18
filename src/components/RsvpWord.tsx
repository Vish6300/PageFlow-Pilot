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

      text.setAttribute('x', '0')
      const focusIndex = token.prefix.length
      const wordWidth = text.getComputedTextLength()
      const focusStart = text.getStartPositionOfChar(focusIndex).x
      const focusEnd = text.getEndPositionOfChar(focusIndex).x
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
          <stop offset="0%" stopColor="#78716c" />
          <stop ref={prefixEndRef} offset="0%" stopColor="#78716c" />
          <stop ref={focusStartRef} offset="0%" stopColor="#4338ca" />
          <stop ref={focusEndRef} offset="100%" stopColor="#4338ca" />
          <stop ref={suffixStartRef} offset="100%" stopColor="#292524" />
          <stop offset="100%" stopColor="#292524" />
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
