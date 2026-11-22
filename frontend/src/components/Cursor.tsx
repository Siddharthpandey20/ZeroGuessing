import { useEffect, useRef } from 'react'
import { reducedMotion } from '../lib/motion'

/**
 * wembi's cursor: a small lime dot that trails the pointer and swells over anything clickable.
 * Fine pointers only; touch and reduced-motion users keep the system cursor alone.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return
    const el = dot.current
    if (!el) return
    let x = -100, y = -100, tx = -100, ty = -100, raf = 0, shown = false
    const move = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      if (!shown) {
        shown = true
        x = tx
        y = ty
        el.dataset.on = 'true'
      }
      const t = e.target as Element | null
      const hot = !!t?.closest('a, button, [role="button"], input, textarea, select, label')
      el.dataset.hot = hot ? 'true' : ''
    }
    const leave = () => {
      shown = false
      el.dataset.on = ''
    }
    const down = () => (el.dataset.down = 'true')
    const up = () => (el.dataset.down = '')
    const tick = () => {
      x += (tx - x) * 0.22
      y += (ty - y) * 0.22
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [])
  return <div ref={dot} className="cursor-dot" aria-hidden="true"><span /></div>
}
