import { useEffect, useState, type CSSProperties } from 'react'
import { reducedMotion } from '../lib/motion'
import styles from './Intro.module.css'

const LINE = 'Every claim needs a source.'
const KEY = 'zg-intro-seen'

function seen() {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

/**
 * echo's opening: a line types itself, the wordmark draws in outline and fills, then the curtain lifts.
 * Once per session, about 2.6 s, skipped by any click or key, never shown under reduced motion.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'off' | 'run' | 'lift'>(() => (seen() || reducedMotion() ? 'off' : 'run'))

  useEffect(() => {
    if (state === 'off') {
      onDone()
      return
    }
    if (state !== 'run') return
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* private mode */
    }
    const lift = window.setTimeout(() => setState('lift'), 2350)
    const skip = () => setState('lift')
    window.addEventListener('keydown', skip, { once: true })
    window.addEventListener('pointerdown', skip, { once: true })
    return () => {
      window.clearTimeout(lift)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [state, onDone])

  useEffect(() => {
    if (state !== 'lift') return
    onDone()
    const t = window.setTimeout(() => setState('off'), 900)
    return () => window.clearTimeout(t)
  }, [state, onDone])

  if (state === 'off') return null
  return (
    <div className={styles.intro} data-state={state} aria-hidden="true">
      <div className={styles.grid} />
      <p className={`${styles.line} readout`}>
        {Array.from(LINE).map((ch, i) => (
          <span key={i} style={{ '--i': i } as CSSProperties}>{ch === ' ' ? ' ' : ch}</span>
        ))}
      </p>
      <svg className={styles.mark} viewBox="0 0 900 160" role="presentation">
        <text x="450" y="118" textAnchor="middle" className={styles.ghost}>zeroguess</text>
        <text x="450" y="118" textAnchor="middle" className={styles.stroke}>zeroguess</text>
        <text x="450" y="118" textAnchor="middle" className={styles.fill}>zeroguess</text>
      </svg>
      <span className={styles.skip}>Press any key to skip</span>
    </div>
  )
}
