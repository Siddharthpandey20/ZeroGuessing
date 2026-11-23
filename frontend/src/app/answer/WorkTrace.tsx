import { useEffect, useId, useState } from 'react'
import { ArrowRightLeft, Check, ChevronDown, X } from 'lucide-react'
import { plural, useT, type T } from '../../lib/i18n'
import type { Stage, TraceStep } from '../../lib/types'
import { fmtDate, shortDoc } from './selection'
import styles from './WorkTrace.module.css'

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
const clauseOf = (key: string) => key.split(':').slice(1).join(':')

function stageLabel(t: T, stage: Stage | null, info: { evidence?: number; claims?: number }) {
  switch (stage) {
    case 'translating_question': return t('Reading the Hindi question')
    case 'retrieving': return t('Searching the documents')
    case 'drafting': return t('Drafting claims from {n} passages', { n: info.evidence ?? '' })
    case 'verifying': return t('Checking each claim against its quote')
    case 'checking_contradictions': return t('Looking for conflicting clauses')
    case 'translating_answer': return t('Translating the verified claims')
    default: return t('Sending the question')
  }
}

function title(t: T, s: TraceStep): string {
  switch (s.id) {
    case 'understand': return t('Understood the follow-up')
    case 'translate_question': return t('Translated the question')
    case 'search': return t('Searched {docs}', { docs: plural(t, s.docs ?? 0, 'document') })
    case 'versions': return t('Checked which version applies on {date}', { date: fmtDate(s.as_of ?? '') })
    case 'gate': return t('No passage is close enough to answer')
    case 'draft': return t('Drafted {claims} from the evidence', { claims: plural(t, s.claims ?? 0, 'claim') })
    case 'verify': return t('Checked each claim against its quote')
    case 'conflicts': return t('Looked for conflicting clauses')
    case 'translate_answer': return t('Translated the verified claims')
    default: return s.id
  }
}

function Detail({ s }: { s: TraceStep }) {
  const t = useT()
  switch (s.id) {
    case 'understand':
      return <p className={styles.detail}>“{s.resolved}”</p>
    case 'translate_question':
      return s.english ? <p className={styles.detail}>“{s.english}”</p> : null
    case 'search':
      return (
        <>
          <p className={styles.detail}>
            {t('{n} matching passages for', { n: s.passages ?? 0 })} “{(s.terms ?? []).join(' ')}”
          </p>
          {!!s.sources?.length && (
            <ul className={styles.sources} aria-label={t('Passages read')}>
              {s.sources.map((x) => (
                <li key={x.sentence_id} className={styles.source} data-status={x.status !== 'current' ? x.status : undefined}>
                  <span className={styles.sourceDoc}>{shortDoc(x.doc_title)}</span>
                  <span className={styles.sourceWhere}>{x.clause_ref && !x.clause_ref.startsWith('_') ? `${x.clause_ref} · ` : ''}p.{x.page}</span>
                  {x.added_for_amendment && <span className={styles.sourceTag}>{t('amendment')}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )
    case 'versions':
      return (
        <ul className={styles.lines}>
          {(s.clauses ?? []).map((c) => (
            <li key={c.key}>
              {t('Clause {ref}: changed {n}', { ref: clauseOf(c.key), n: plural(t, c.changes, 'time') })}
              {c.by ? `; ${t('in force: {by}', { by: shortDoc(c.by) })}${c.since ? ` ${t('since {date}', { date: fmtDate(c.since) })}` : ''}` : ''}
              {c.pending > 0 ? `; ${t('{n} change not yet in force', { n: c.pending })}` : ''}
            </li>
          ))}
        </ul>
      )
    case 'gate':
      return (
        <p className={styles.detail}>
          {t('Closest match scored {score}; an answer needs {need}. Nothing was drafted, so nothing could be guessed.', {
            score: s.best_score?.toFixed(2) ?? '–', need: s.threshold?.toFixed(2) ?? '–',
          })}
        </p>
      )
    case 'draft':
      return s.missing?.length ? <p className={styles.detail}>{t('Not stated in the documents')}: {s.missing.join('; ')}</p> : (
        <p className={styles.detail}>{t('Every claim must cite the passages it rests on.')}</p>
      )
    case 'verify': {
      const checks = s.checks ?? []
      const ok = checks.filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted').length
      if (!checks.length) return <p className={styles.detail}>{t('Nothing to check: no claim was drafted, so nothing is shown.')}</p>
      return (
        <>
          <p className={styles.detail}>
            {t('{ok} of {n} passed: the quote exists, every number matches it, the clause is in force, and a strict check agrees.', { ok, n: checks.length })}
          </p>
          <ul className={styles.checks}>
            {checks.map((c, i) => (
              <li key={i} data-verdict={c.verdict}>
                <span className={styles.mark} aria-hidden="true">
                  {c.verdict === 'supported' ? <Check size={11} strokeWidth={3} /> : c.verdict === 'conflicted' ? <ArrowRightLeft size={11} strokeWidth={2.4} /> : <X size={11} strokeWidth={3} />}
                </span>
                <span className="sr-only">{t(c.verdict === 'supported' ? 'Passed' : c.verdict === 'conflicted' ? 'Passed, conflicting' : 'Blocked')}: </span>
                <span className={styles.checkText}>{c.text}</span>
                {c.verdict !== 'supported' && c.reason && <span className={styles.checkWhy}>{c.reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )
    }
    case 'conflicts':
      return (
        <p className={styles.detail}>
          {s.relevant ? t('{n} conflicting pair touches this answer: shown side by side below.', { n: s.relevant }) : t('No conflicting clause touches this answer.')}
        </p>
      )
    case 'translate_answer':
      return <p className={styles.detail}>{t('{kept} of {total} kept. A translation that changed any number was dropped.', { kept: s.kept ?? 0, total: s.total ?? 0 })}</p>
    default:
      return null
  }
}

function Steps({ steps, live }: { steps: TraceStep[]; live?: string }) {
  return (
    <ol className={styles.steps}>
      {steps.map((s, i) => (
        <li key={`${s.id}-${i}`} className={styles.step} data-id={s.id}>
          <StepHead s={s} />
          <Detail s={s} />
        </li>
      ))}
      {live && (
        <li className={styles.step} data-live="true">
          <div className={styles.stepHead}>
            <span className={styles.stepTitle}>{live}</span>
          </div>
        </li>
      )}
    </ol>
  )
}

function StepHead({ s }: { s: TraceStep }) {
  const t = useT()
  return (
    <div className={styles.stepHead}>
      <span className={styles.stepTitle}>{title(t, s)}</span>
      {s.ms > 0 && <span className={styles.ms}>{secs(s.ms)}</span>}
    </div>
  )
}

/**
 * The work behind an answer, like a model's "thinking" toggle: while it runs, each finished step appears with what
 * it read and how long it took; afterwards it folds into one line ("Verified in 18 s") that opens the same list.
 */
export function WorkTrace({ steps, totalMs, cached, docs, noProof }: { steps: TraceStep[]; totalMs?: number; cached?: boolean; docs?: number; noProof?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!steps.length) return null
  const search = steps.find((s) => s.id === 'search')
  const checks = steps.find((s) => s.id === 'verify')?.checks?.length ?? 0
  const abstained = noProof || steps.some((s) => s.id === 'gate')
  const summary = [
    search ? plural(t, docs ?? search.docs ?? 0, 'document') : null,
    search ? plural(t, search.passages ?? 0, 'passage') : null,
    checks ? plural(t, checks, 'check') : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className={styles.trace}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className={styles.glyph} data-tone={abstained ? 'stop' : 'done'} aria-hidden="true" />
        <span className={styles.head}>
          {cached ? t(abstained ? 'Checked earlier' : 'Verified earlier') : abstained ? t('Checked in {t}', { t: secs(totalMs ?? 0) }) : t('Verified in {t}', { t: secs(totalMs ?? 0) })}
        </span>
        {summary && <span className={styles.summary}>{summary}</span>}
        <ChevronDown size={14} strokeWidth={2} className={styles.chev} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className={styles.body}>
          {cached && <p className={styles.cachedNote}>{t('Same question, documents and date as before: this is the stored answer, already verified.')}</p>}
          <Steps steps={steps} />
        </div>
      )}
    </div>
  )
}

/** The same list while the answer is still being worked out, open, with a running clock. */
export function LiveTrace({ steps, stage, info, startedAt }: {
  steps: TraceStep[]; stage: Stage | null; info: { evidence?: number; claims?: number }; startedAt: number
}) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(h)
  }, [])
  return (
    <div className={styles.trace} data-live="true" aria-live="polite" aria-busy="true">
      <div className={styles.toggle} data-static="true">
        <span className={styles.glyph} data-tone="live" aria-hidden="true" />
        <span className={styles.head}>{t('Working')}</span>
        <span className={`${styles.summary} tnum`}>{secs(Math.max(0, now - startedAt))}</span>
      </div>
      <div className={styles.body}>
        <Steps steps={steps} live={stageLabel(t, stage, info)} />
      </div>
      <div className={styles.ghost} aria-hidden="true">
        <span className="skeleton" style={{ width: '92%' }} />
        <span className="skeleton" style={{ width: '74%' }} />
      </div>
    </div>
  )
}
