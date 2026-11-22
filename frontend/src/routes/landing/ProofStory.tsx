import { useState, type CSSProperties, type ReactNode } from 'react'
import { CitationChip } from '../../components/CitationChip'
import { useScrollProgress } from '../../lib/motion'
import { CHAIN, SRC } from './specimens'
import styles from './ProofStory.module.css'

interface Step { n: string; title: string; body: string; media: ReactNode }

const STEPS: Step[] = [
  {
    n: '01', title: 'Cited to the line.', body: 'Each claim links to the document, page and exact sentence. Hover a citation and the page appears.',
    media: (
      <div className={styles.cite}>
        <p className={styles.citeClaim}>
          <span className="mark-proof">Penal charges on an overdue instalment are 2% a year over the contracted rate.</span>{' '}
          <CitationChip source={SRC.a81} />
        </p>
        <img className={`crop ${styles.bigCrop}`} src={SRC.a81.img} alt="Master Policy on Retail Loans, clause 8.1 highlighted on page 1" loading="lazy" decoding="async" />
      </div>
    ),
  },
  {
    n: '02', title: 'Conflicts, side by side.', body: 'When two documents disagree on the same subject, both quotes are shown and neither is picked for you.',
    media: (
      <div className={styles.conflict}>
        <Side label="Master Policy 8.1" value="2% p.a. over the contracted rate" src={SRC.a81} />
        <span className={`${styles.neq} readout`} aria-hidden="true">≠</span>
        <Side label="Key Facts Statement 2.2" value="24% p.a. on the overdue amount" src={SRC.d22} />
      </div>
    ),
  },
  {
    n: '03', title: 'The rule in force today.', body: 'Amendments are followed through every circular. Move the date and the answer moves with it.',
    media: <ChainScrubber />,
  },
  {
    n: '04', title: '“I don’t have proof.”', body: 'No sentence is shown without a quote. You get what was searched, what came closest and what is missing.',
    media: (
      <div className={styles.abstain}>
        <p className={styles.abstainQ}>What is the foreclosure charge on gold loans?</p>
        <p className={styles.abstainA}>I don’t have proof for this.</p>
        <dl className={styles.facts}>
          <div><dt>Missing</dt><dd>A clause on foreclosure charges for gold loans</dd></div>
          <div><dt>Searched</dt><dd>7 documents for “foreclosure charge gold loans”</dd></div>
          <div><dt>Closest</dt><dd>Master Policy 7.2 and 7.3, which cover home loans only</dd></div>
        </dl>
      </div>
    ),
  },
]

/** wembi's pinned feature list: the media panel holds while the four proofs advance with the scroll. */
export function ProofStory() {
  const [ref, p] = useScrollProgress<HTMLElement>()
  const active = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length * 0.999))
  const within = p * STEPS.length - active

  return (
    <section ref={ref} id="proofs" data-section="Proofs" className={styles.wrap} aria-label="The four proofs">
      <div className={styles.sticky}>
        <div className={styles.grid}>
          <div className={styles.stage}>
            {STEPS.map((s, i) => (
              <div key={s.n} className={styles.pane} data-on={i === active || undefined} aria-hidden={i !== active}>
                {s.media}
              </div>
            ))}
            <span className={`${styles.counter} readout`} aria-hidden="true">
              {STEPS[active].n} / 04
            </span>
          </div>
          <ol className={styles.list}>
            {STEPS.map((s, i) => (
              <li key={s.n} className={styles.item} data-state={i < active ? 'past' : i === active ? 'now' : 'next'}>
                <span className={`${styles.n} readout`}>{s.n}</span>
                <h3 className={styles.title}><span>{s.title}</span></h3>
                <p className={styles.body}>{s.body}</p>
                <span className={styles.bar} aria-hidden="true" style={{ '--w': i < active ? 1 : i === active ? within : 0 } as CSSProperties} />
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* small screens: the same story, stacked */}
      <ol className={styles.stack}>
        {STEPS.map((s) => (
          <li key={s.n}>
            <span className={`${styles.n} readout`}>{s.n}</span>
            <h3 className={styles.title}><span>{s.title}</span></h3>
            <p className={styles.body}>{s.body}</p>
            <div className={styles.stackMedia}>{s.media}</div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Side({ label, value, src }: { label: string; value: string; src: typeof SRC.a81 }) {
  return (
    <div className={styles.side}>
      <div className={styles.sideHead}>
        <span className={styles.sideLabel}>{label}</span>
        <span className="mark-proof mark-conflict">{value}</span>
      </div>
      <img className="crop" src={src.img} alt={`${src.docTitle}, clause ${src.clause}`} loading="lazy" decoding="async" />
    </div>
  )
}

function ChainScrubber() {
  const [i, setI] = useState(CHAIN.length - 1)
  const cur = CHAIN[i]
  return (
    <div className={styles.chain}>
      <div className={styles.chainAnswer} aria-live="polite">
        <span className={styles.chainLabel}>Prepayment penalty, floating rate, on {cur.label}</span>
        <span className={styles.chainValue}><span key={cur.value} className={styles.chainValueIn}>{cur.value}</span></span>
        <span className={styles.chainOf}>{cur.of}, per {cur.doc}</span>
      </div>
      <img key={cur.date} className={`crop ${styles.chainCrop}`} src={cur.source.img} alt={`${cur.doc}, highlighted`} decoding="async" />
      <div className={styles.track} role="radiogroup" aria-label="Date the rule is checked on">
        {CHAIN.map((c, k) => (
          <button key={c.date} type="button" role="radio" aria-checked={k === i} className={styles.stop} data-on={k <= i || undefined} onClick={() => setI(k)}>
            <span className={styles.stopDot} aria-hidden="true" />
            <span className={styles.stopDate}>{c.label}</span>
            <span className={styles.stopNote}>{c.note}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
