import { useEffect, useState } from 'react'
import { reducedMotion } from '../lib/motion'
import styles from './Intro.module.css'

// Plays on every fresh load of the site (a reload or a new visit), but not again when the landing page is reached
// by navigating inside the app without reloading: this module state lives exactly as long as the page does.
let playedThisLoad = false

const CHECKS = ['Quote found', 'Numbers match', 'In force today', 'Quote supports it']
const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The opening shows the product doing its one job, in miniature, instead of promising it: a clause from a circular,
 * a claim whose words are found in it (highlighted, four checks tick), and a claim with no source, struck out and
 * blocked. Then the wordmark, and the curtain lifts. About 3.3 s, once per page load, skipped by any click or key,
 * never shown under reduced motion.
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
    const lift = window.setTimeout(() => setState('lift'), 3300)
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
      <div className={styles.stage}>
        <p className={`${styles.kicker} readout`}>
          <span className={styles.pulse} /> Checking against the rules in force on {today}
        </p>

        <figure className={styles.page}>
          <figcaption className={`${styles.source} readout`}>Circular SCB/RL/2026/03 · ¶3 · p.1</figcaption>
          <p className={styles.clause}>
            The prepayment penalty on floating-rate home loans for individual borrowers{' '}
            <mark className={styles.hit}>shall be Nil</mark>.
          </p>
        </figure>

        <ol className={styles.claims}>
          <li className={styles.claim} data-k="ok">
            <p className={styles.claimText}>
              The prepayment penalty is Nil.<span className={styles.cite}>1</span>
            </p>
            <ul className={styles.checks}>
              {CHECKS.map((c, i) => (
                <li key={c} style={{ animationDelay: `${1180 + i * 170}ms` }}>
                  <span className={styles.tick} style={{ animationDelay: `${1260 + i * 170}ms` }} />
                  {c}
                </li>
              ))}
            </ul>
          </li>
          <li className={styles.claim} data-k="no">
            <p className={styles.claimText}>
              <span className={styles.struck}>Gold loans carry a 1% foreclosure fee.</span>
              <span className={`${styles.blocked} readout`}>No proof · blocked</span>
            </p>
          </li>
        </ol>

        <p className={styles.mark}>zeroguess</p>
      </div>
      <span className={styles.skip}>Press any key to skip</span>
    </div>
  )
}
