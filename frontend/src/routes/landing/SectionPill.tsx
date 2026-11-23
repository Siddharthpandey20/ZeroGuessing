import { useEffect, useState } from 'react'

/** wembi's floating pill, bottom left: always says which part of the page you are in. */
export function SectionPill() {
  const [label, setLabel] = useState<string | null>(null)
  // hidden on the hero itself: you are obviously at the start, and it would sit on the hero's proof points
  const [past, setPast] = useState(false)
  useEffect(() => {
    const on = () => setPast(window.scrollY > window.innerHeight * 0.6)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'))
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (vis) setLabel((vis.target as HTMLElement).dataset.section ?? null)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.01] },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  return (
    <div className="section-pill" data-on={label && past ? 'true' : undefined} aria-hidden="true">
      <span className="section-pill-dot" />
      <span className="section-pill-text" key={label ?? ''}>{label ?? ''}</span>
    </div>
  )
}
