import type { CSSProperties } from 'react'
import { useScrollProgress } from '../../lib/motion'
import styles from './ScrollWords.module.css'

/**
 * wembi's statement paragraph: it sits still while you scroll and each word darkens in turn.
 * Words listed in `marks` get the lime proof marker once they are lit.
 */
export function ScrollWords({ text, marks = [] }: { text: string; marks?: string[] }) {
  const [ref, p] = useScrollProgress<HTMLElement>()
  const words = text.split(' ')
  const n = words.length
  const lit = p * (n + 4) - 2
  return (
    <section ref={ref} className={styles.wrap} aria-label="What this is for">
      <div className={styles.sticky}>
        <div className={styles.inner}>
          <span className={`${styles.index} readout`}>N°000</span>
          <p className={styles.text}>
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">
              {words.map((w, i) => {
                const k = Math.max(0, Math.min(1, lit - i))
                const mark = marks.some((m) => w.toLowerCase().startsWith(m))
                return (
                  <span key={i} className={styles.word} data-mark={mark || undefined} data-lit={k > 0.98 || undefined} style={{ '--k': k } as CSSProperties}>
                    {w}{' '}
                  </span>
                )
              })}
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}
