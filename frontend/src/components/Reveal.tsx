import { createElement, type CSSProperties, type ReactNode } from 'react'
import { useInView } from '../lib/motion'

/** Fades and rises into place the first time it scrolls into view. Visible without JavaScript (see global.css). */
export function Reveal({ as = 'div', delay = 0, className, children, style, variant = 'rise' }: {
  as?: string; delay?: number; className?: string; children: ReactNode; style?: CSSProperties; variant?: 'rise' | 'fade' | 'scale' | 'clip'
}) {
  const [ref, inView] = useInView<HTMLElement>()
  return createElement(as, {
    ref,
    className,
    'data-reveal': variant,
    'data-in': inView || undefined,
    style: { ...style, '--d': `${delay}ms` } as CSSProperties,
    children,
  })
}

/** A headline whose lines slide up out of a mask, word by word. */
export function SplitText({ text, as = 'h2', className, delay = 0, step = 55 }: { text: string; as?: string; className?: string; delay?: number; step?: number }) {
  const [ref, inView] = useInView<HTMLElement>()
  const words = text.split(' ')
  return createElement(
    as,
    { ref, className, 'data-split': '', 'data-in': inView || undefined, 'aria-label': text },
    words.map((w, i) => (
      <span key={i} className="split-word" aria-hidden="true">
        <span className="split-inner" style={{ '--d': `${delay + i * step}ms` } as CSSProperties}>{w}</span>
        {i < words.length - 1 ? ' ' : ''}
      </span>
    )),
  )
}
