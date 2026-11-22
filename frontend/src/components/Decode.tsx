import { useEffect, useRef, useState } from 'react'

const GLYPHS = '▯▮░▒/\\|=+-<>0123456789'

/** echo-style text that resolves letter by letter. Screen readers get the final text at once. */
export function Decode({ text, className, speed = 22 }: { text: string; className?: string; speed?: number }) {
  const [shown, setShown] = useState(text)
  const prev = useRef(text)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text)
      return
    }
    const from = prev.current
    prev.current = text
    let frame = 0
    const total = text.length + 6
    const id = window.setInterval(() => {
      frame++
      const out = Array.from(text, (ch, i) => {
        if (ch === ' ') return ' '
        if (i < frame - 6) return ch
        if (i < frame) return GLYPHS[(i * 7 + frame) % GLYPHS.length]
        return from[i] ?? ''
      }).join('')
      setShown(out)
      if (frame >= total) {
        window.clearInterval(id)
        setShown(text)
      }
    }, speed)
    return () => window.clearInterval(id)
  }, [text, speed])

  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  )
}
