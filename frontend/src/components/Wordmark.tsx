import { useLayoutEffect, useRef, type CSSProperties } from 'react'

/**
 * The wordmark set to fill its container edge to edge (wembi's hero mark), letters split so they can
 * rise in one by one, with echo's offset outline ghost behind the solid letters.
 */
export function Wordmark({ text = 'zeroguess', className, play = true }: { text?: string; className?: string; play?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = box.current, pr = probe.current
    if (!el || !pr) return
    const fit = () => {
      const w = pr.getBoundingClientRect().width // measured at 100px
      if (w > 0) el.style.setProperty('--wm-size', `${(el.clientWidth / w) * 100 * 0.995}px`)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    document.fonts?.ready.then(fit)
    return () => ro.disconnect()
  }, [text])

  const letters = Array.from(text)
  return (
    <div ref={box} className={`wm ${className ?? ''}`} data-play={play || undefined} aria-label={text} role="img">
      <span ref={probe} className="wm-probe" aria-hidden="true">{text}</span>
      <span className="wm-ghost" aria-hidden="true">{text}</span>
      <span className="wm-solid" aria-hidden="true">
        {letters.map((l, i) => (
          <span key={i} className="wm-l" style={{ '--i': i } as CSSProperties}>{l}</span>
        ))}
      </span>
    </div>
  )
}
