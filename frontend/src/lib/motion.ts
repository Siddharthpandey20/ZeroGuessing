import { useEffect, useRef, useState, type RefObject } from 'react'

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** true once the element has entered the viewport (fires once). */
export function useInView<T extends Element>(opts: { margin?: string; threshold?: number; once?: boolean } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  const { margin = '0px 0px -12% 0px', threshold = 0.15, once = true } = opts
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reducedMotion()) {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          if (once) io.disconnect()
        } else if (!once) setInView(false)
      },
      { rootMargin: margin, threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin, threshold, once])
  return [ref, inView]
}

/**
 * Scroll progress of a tall element through the viewport: 0 when its top reaches the top of the viewport,
 * 1 when its bottom reaches the bottom. Written to a CSS variable (--p) on the element and returned (throttled to rAF).
 */
export function useScrollProgress<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [p, setP] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const read = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const span = r.height - window.innerHeight
      const v = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : r.top < 0 ? 1 : 0
      el.style.setProperty('--p', v.toFixed(4))
      setP((old) => (Math.abs(old - v) > 0.002 ? v : old))
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [])
  return [ref, p]
}

/** Count up to a number when it first appears. */
export function useCountUp(target: number, run: boolean, ms = 900) {
  const [v, setV] = useState(run && !reducedMotion() ? 0 : target)
  useEffect(() => {
    if (!run || reducedMotion()) {
      setV(target)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(target * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms])
  return v
}
