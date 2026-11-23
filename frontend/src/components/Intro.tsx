import { useEffect, useState, type CSSProperties } from 'react'
import { reducedMotion } from '../lib/motion'
import styles from './Intro.module.css'

const LINE = 'Every claim needs a source.'

// Plays on every fresh load of the site (a reload or a new visit), but not again when the landing page is reached
// by navigating inside the app without reloading: this module state lives exactly as long as the page does.
let playedThisLoad = false

/**
 * echo's opening: a line types itself, the wordmark draws in outline and fills, then the curtain lifts.
 * Once per page load, about 2.6 s, skipped by any click or key, never shown under reduced motion.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'off' | 'run' | 'lift'>(() => (playedThisLoad || reducedMotion() ? 'off' : 'run'))

  useEffect(() => {
    if (state === 'off') {
      onDone()
      return
    }
    if (state !== 'run') return
    playedThisLoad = true
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
