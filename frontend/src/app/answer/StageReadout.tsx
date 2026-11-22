import { Decode } from '../../components/Decode'
import type { Stage } from '../../lib/types'
import styles from './StageReadout.module.css'

const ORDER: Stage[] = ['retrieving', 'drafting', 'verifying', 'checking_contradictions']

function label(stage: Stage | null, info: { evidence?: number; claims?: number }) {
  switch (stage) {
    case 'translating_question': return 'Reading the Hindi question'
    case 'retrieving': return 'Retrieving evidence from the library'
    case 'drafting': return `Drafting claims from ${info.evidence ?? 'the'} passages`
    case 'verifying': return `Verifying ${info.claims ?? 'each'} ${info.claims === 1 ? 'claim' : 'claims'} against their quotes`
    case 'checking_contradictions': return 'Checking the evidence for conflicts'
    case 'translating_answer': return 'Translating the verified claims'
    default: return 'Sending the question'
  }
}

/** The pipeline as it runs: echo's instrument readout, one tick per stage. */
export function StageReadout({ stage, info }: { stage: Stage | null; info: { evidence?: number; claims?: number } }) {
  const idx = stage ? ORDER.indexOf(stage) : -1
  return (
    <div className={styles.wrap} aria-live="polite" aria-busy="true">
      <div className={styles.line}>
        <span className={styles.pulse} aria-hidden="true" />
        <Decode text={label(stage, info)} className={`readout ${styles.text}`} />
      </div>
      <ol className={styles.ticks} aria-hidden="true">
        {ORDER.map((s, i) => (
          <li key={s} data-state={i < idx ? 'done' : i === idx ? 'now' : 'next'} />
        ))}
      </ol>
      <div className={styles.ghost} aria-hidden="true">
        <span className="skeleton" style={{ width: '92%' }} />
        <span className="skeleton" style={{ width: '78%' }} />
        <span className="skeleton" style={{ width: '64%' }} />
      </div>
    </div>
  )
}
