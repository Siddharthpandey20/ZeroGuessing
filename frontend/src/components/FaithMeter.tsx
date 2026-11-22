import styles from './FaithMeter.module.css'

export type SegmentTone = 'supported' | 'conflicted' | 'unsupported' | 'contradicted' | 'pending'

/**
 * Faithfulness, drawn the way it is counted: one segment per drafted claim (before blocking),
 * filled when a source quote backs it. The percentage is the backend's own figure.
 */
export function FaithMeter({ segments, pct, compact }: { segments: SegmentTone[]; pct: number | null; compact?: boolean }) {
  const backed = segments.filter((s) => s === 'supported' || s === 'conflicted').length
  const total = segments.length
  return (
    <div className={styles.meter} data-compact={compact || undefined}>
      <div className={styles.figure}>
        <span className={`${styles.pct} readout`}>{pct === null ? '–' : `${Math.round(pct)}%`}</span>
        <span className={styles.caption}>
          {total === 0 ? 'No claims drafted' : `${backed} of ${total} drafted ${total === 1 ? 'claim' : 'claims'} backed by a quote`}
        </span>
      </div>
      {total > 0 && (
        <div className={styles.track} role="img" aria-label={`${backed} of ${total} claims backed by a source quote`}>
          {segments.map((s, i) => (
            <span key={i} className={styles.seg} data-tone={s} style={{ transitionDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}
    </div>
  )
}
