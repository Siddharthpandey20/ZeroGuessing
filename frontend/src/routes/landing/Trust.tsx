import { FileLock2, KeyRound, Link2, ScanSearch, ShieldCheck, Workflow } from 'lucide-react'
import { Reveal } from '../../components/Reveal'
import m from './metrics.json'
import styles from './Trust.module.css'

const pct = (x: number) => `${Math.round(x * 100)}%`
const runDate = (() => {
  const s = String(m.run)
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
})()

const FIGURES: { value: string; label: string; note: string; tone?: 'proof' | 'block' }[] = [
  { value: pct(m.answer_correctness), label: 'Answers correct', note: 'The expected figure or rule is in the answer.', tone: 'proof' },
  { value: pct(m.citation_validity), label: 'Citations valid', note: 'The cited document, page and clause hold the quote.', tone: 'proof' },
  { value: pct(m.contradiction_recall), label: 'Conflicts found', note: 'Real contradictions between documents flagged, with both quotes.', tone: 'proof' },
  { value: pct(m.false_conflict_rate), label: 'False alarms', note: 'Conflicts reported where the documents agree. Lower is better.' },
  { value: pct(1 - m.over_abstention), label: 'Answered, not refused', note: 'Answerable questions given a verified answer instead of a needless refusal.', tone: 'proof' },
  { value: `${Math.round((m.first_answer_p50_ms ?? 0) / 1000)} s`, label: 'To a verified answer', note: 'Median time until the checked, cited answer is on screen.' },
]

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
        <Reveal as="p" className={styles.lead}>
          {m.questions} questions with known answers across ten real Indian health insurance policies, scored by a script on
          {' '}{runDate}: single-policy and cross-policy questions, calculations, Hindi, contradictions between documents,
          and questions the documents cannot answer.
        </Reveal>
      </div>
      <ol className={styles.figures}>
        {FIGURES.map((f, i) => (
          <Reveal as="li" key={f.label} delay={i * 80} className={styles.figure}>
            <span className={styles.value} data-tone={f.tone}>{f.value}</span>
            <span className={styles.label}>{f.label}</span>
            <span className={styles.note}>{f.note}</span>
          </Reveal>
        ))}
      </ol>
      <Reveal as="p" className={styles.repro}>
        <span className="readout">Re-run it</span> <code>uv run python -m scripts.run_eval --gold eval/gold_policies.jsonl</code> rewrites these numbers from a fresh run.
      </Reveal>
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
