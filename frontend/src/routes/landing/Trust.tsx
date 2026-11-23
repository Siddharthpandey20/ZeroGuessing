import { ArrowDownRight, ArrowUpRight, FileLock2, KeyRound, Link2, ScanSearch, ShieldCheck, Workflow } from 'lucide-react'
import { Reveal } from '../../components/Reveal'
import m from './metrics.json'
import luna from './metrics.luna.json'
import styles from './Trust.module.css'

// Figures are compared after rounding to what is displayed, so the shown change matches the shown numbers.
const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100

type Figure = {
  now: number; before: number; unit: 'pct' | 'sec'; lowerIsBetter?: boolean
  label: string; note: string; tone?: 'proof' | 'block'
}

const P = (x: number) => r1(x * 100)
const S = (ms: number) => r2(ms / 1000)
const FIGURES: Figure[] = [
  { now: P(m.answer_correctness), before: P(luna.answer_correctness), unit: 'pct', label: 'Answers correct', note: 'The expected figure or rule is in the answer.', tone: 'proof' },
  { now: P(m.citation_validity), before: P(luna.citation_validity), unit: 'pct', label: 'Citations valid', note: 'The cited document, page and clause hold the quote.', tone: 'proof' },
  { now: P(m.contradiction_recall), before: P(luna.contradiction_recall), unit: 'pct', label: 'Conflicts found', note: 'Real contradictions between documents flagged, with both quotes.', tone: 'proof' },
  { now: P(m.false_conflict_rate), before: P(luna.false_conflict_rate), unit: 'pct', lowerIsBetter: true, label: 'False alarms', note: 'Conflicts reported where the documents agree. Lower is better.' },
  { now: P(1 - m.over_abstention), before: P(1 - luna.over_abstention), unit: 'pct', label: 'Answered, not refused', note: 'Answerable questions given a verified answer instead of a needless refusal.', tone: 'proof' },
  { now: S(m.first_answer_p50_ms), before: S(luna.first_answer_p50_ms), unit: 'sec', lowerIsBetter: true, label: 'To a verified answer', note: 'Median time until the checked, cited answer is on screen. Lower is better.' },
]

const fmt = (x: number, unit: Figure['unit']) => (unit === 'pct' ? `${x.toFixed(1)}%` : `${x.toFixed(2)} s`)

/** Stock-ticker style difference from GPT-6 Luna (high): the arrow follows the number, the colour says good or bad. */
function Delta({ f }: { f: Figure }) {
  const d = f.unit === 'pct' ? r1(f.now - f.before) : r2(f.now - f.before)
  if (d === 0) return <span className={styles.delta} data-trend="flat">– 0 {f.unit === 'pct' ? 'pts' : 's'}</span>
  const up = d > 0
  const good = up !== Boolean(f.lowerIsBetter)
  const Icon = up ? ArrowUpRight : ArrowDownRight
  const size = f.unit === 'pct' ? `${Math.abs(d).toFixed(1)} pts` : `${Math.abs(d).toFixed(2)} s`
  return (
    <span
      className={styles.delta}
      data-trend={good ? 'good' : 'bad'}
      title={`GPT-6 Luna (high): ${fmt(f.before, f.unit)}`}
      aria-label={`${up ? 'Up' : 'Down'} ${size} vs GPT-6 Luna (high) at ${fmt(f.before, f.unit)}`}
    >
      <Icon size={16} strokeWidth={2.4} aria-hidden="true" />
      {up ? '+' : '−'}{size}<span className={styles.vs}>vs GPT-6 Luna</span>
    </span>
  )
}

const SAFEGUARDS = [
  { icon: FileLock2, h: 'Answers stay inside the chat’s documents', p: 'A chat answers only from the PDFs added to it. Another person’s uploads never reach your answers.' },
  { icon: ShieldCheck, h: 'Private by default', p: 'Chats belong to the person who started them. Viewers see only their own documents; only admins manage the library.' },
  { icon: KeyRound, h: 'Sessions that can’t be replayed', p: 'Short-lived access tokens in HttpOnly cookies, refresh tokens that rotate on every use, and a reused token ends the session. Passwords are hashed with Argon2.' },
  { icon: Link2, h: 'Links you control', p: 'Share links are unguessable, expire in 1 to 30 days, can be revoked at any time, and open a frozen copy rather than the live chat.' },
  { icon: ScanSearch, h: 'Every figure is traceable', p: 'Each sentence opens its page with the passage highlighted. Arithmetic runs in code from the cited figures, never in the model.' },
  { icon: Workflow, h: 'One switch for the model', p: 'Every model call passes through one module, so a model hosted on your own servers can replace the hosted one without changing the checks.' },
]

/** "Measured, not claimed": six headline figures from the latest scored run on real policies (every figure, the weak
 * ones included, is in backend/eval/results). */
export function Measured() {
  return (
    <section id="measured" className={styles.wrap} data-section="Measured" aria-labelledby="measured-title">
      <div className={styles.head}>
        <h2 id="measured-title" className={styles.h2}>Measured, not claimed.</h2>
      </div>
      <ol className={styles.figures}>
        {FIGURES.map((f, i) => (
          <Reveal as="li" key={f.label} delay={i * 80} className={styles.figure}>
            <span className={styles.value} data-tone={f.tone}>{fmt(f.now, f.unit)}</span>
            <Delta f={f} />
            <span className={styles.label}>{f.label}</span>
            <span className={styles.note}>{f.note}</span>
          </Reveal>
        ))}
      </ol>
    </section>
  )
}

/** What protects the documents and the people asking, stated only where the code does it. */
export function Safeguards() {
  return (
    <section id="safeguards" className={styles.wrap} data-section="Safeguards" aria-labelledby="safeguards-title">
      <div className={styles.head}>
        <h2 id="safeguards-title" className={styles.h2}>Built for confidential files.</h2>
        <Reveal as="p" className={styles.lead}>
          Loan agreements, circulars and contracts are not chat material. These are the rules the system keeps.
        </Reveal>
      </div>
      <ul className={styles.guards}>
        {SAFEGUARDS.map(({ icon: Icon, h, p }, i) => (
          <Reveal as="li" key={h} delay={(i % 3) * 90} className={styles.guard}>
            <span className={styles.icon} aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
            <h3>{h}</h3>
            <p>{p}</p>
          </Reveal>
        ))}
      </ul>
    </section>
  )
}
