import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CitationChip } from '../../components/CitationChip'
import { Decode } from '../../components/Decode'
import { FaithMeter, type SegmentTone } from '../../components/FaithMeter'
import { SRC } from './specimens'
import styles from './Specimen.module.css'

const CLAIMS = [
  { text: 'Floating-rate home loans taken by individual borrowers carry no prepayment penalty.', verdict: 'supported', source: SRC.c3 },
  { text: 'This applies from 1 July 2026 and replaces the 1% rate set by Circular 2025/14.', verdict: 'supported', source: SRC.b2 },
  {
    text: 'The penalty is 2% of the outstanding principal.',
    verdict: 'contradicted',
    source: SRC.a72,
    reason: 'Blocked: clause 7.2 of the Master Policy is superseded on this date.',
  },
] as const

const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** The hero's signature: the pipeline playing out on one real question from the demo corpus. */
export function Specimen() {
  // step: 0 retrieving, 1 drafting, 2..4 verifying claim n, 5 done
  const [step, setStep] = useState(0)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(5)
      return
    }
    setStep(0)
    const times = [900, 1700, 2400, 3100, 3800]
    const ids = times.map((t, i) => window.setTimeout(() => setStep(i + 1), t))
    return () => ids.forEach(clearTimeout)
  }, [run])

  const readout =
    step === 0 ? 'Retrieving from 7 documents'
    : step === 1 ? 'Drafting 3 claims with citations'
    : step < 5 ? `Verifying claim ${step - 1} of 3`
    : `Checked, rule in force on ${today}`

  const verified = (i: number) => step >= i + 3
  const segments: SegmentTone[] = CLAIMS.map((c, i) => (verified(i) ? (c.verdict as SegmentTone) : 'pending'))
  const pct = step === 5 ? (2 / 3) * 100 : null

  return (
    <figure className={styles.sheet} aria-label="Example answer from the demo corpus">
      <div className={styles.head}>
        <p className={styles.q}>What is the prepayment penalty on a floating-rate home loan today?</p>
        <button className="btn btn-quiet btn-icon btn-sm" type="button" onClick={() => setRun((r) => r + 1)} aria-label="Play the check again">
          <RotateCcw size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className={styles.readout} data-done={step === 5 || undefined} aria-live="polite">
        <span className={styles.pulse} aria-hidden="true" />
        <Decode text={readout} className="readout" />
      </div>

      <ol className={styles.claims}>
        {CLAIMS.map((c, i) => {
          const state = step < 2 ? 'waiting' : verified(i) ? c.verdict : 'checking'
          return (
            <li key={i} className={styles.claim} data-state={state}>
              <span className={styles.claimText}>{c.text}</span>{' '}
              <CitationChip source={c.source} tone={c.verdict === 'supported' ? 'proof' : 'blocked'} />
              {'reason' in c && state === 'contradicted' && <span className={styles.reason}>{c.reason}</span>}
            </li>
          )
        })}
      </ol>

      <div className={styles.foot}>
        <FaithMeter segments={segments} pct={pct} compact />
      </div>
      <figcaption className={styles.caption}>A real question against the demo corpus. Hover a citation to see the page.</figcaption>
    </figure>
  )
}
