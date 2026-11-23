import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import type { Answer } from '../lib/types'
import type { ReportBlock } from '../lib/report'
import { tr } from '../lib/i18n'
import { AnswerView, ChainStrip, ConflictCard } from '../app/answer/AnswerView'
import { fmtDate, fmtDateTime, type Selection } from '../app/answer/selection'
import styles from './SharedView.module.css'

interface Snapshot {
  title: string
  frozen_at: string
  turns: { turn: number; question: string; as_of: string; answer: Answer }[]
  crops: Record<string, string>
  report?: ReportBlock
}

/** A frozen, read-only copy of a chat: what the system said, with which proof, on which date. No sign-in needed. */
export default function SharedView() {
  const { token } = useParams()
  const snap = useQuery({ queryKey: ['share', token], queryFn: () => api<Snapshot>(`/public/shares/${token}`), retry: false })
  const [open, setOpen] = useState<Selection>(null)

  if (snap.isLoading) return <div className={styles.page}><span className={`skeleton ${styles.skel}`} /></div>
  if (snap.isError || !snap.data) {
    const gone = snap.error instanceof ApiError && [404, 410].includes(snap.error.status)
    return (
      <div className={styles.page}>
        <div className={styles.gone}>
          <h1 className={styles.h1}>{gone ? 'This link is no longer available.' : 'This shared answer could not be loaded.'}</h1>
          <p>{gone ? 'It may have expired or been revoked by the person who shared it.' : 'Check your connection and try again.'}</p>
          <Link to="/" className="btn btn-ink">Go to ZeroGuess</Link>
        </div>
      </div>
    )
  }

  const s = snap.data
  const cropFor = (id: string) => (s.crops[id] ? `data:image/png;base64,${s.crops[id]}` : '')
  const quote = open?.kind === 'citation' ? open.citation : null

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link to="/" className={`${styles.brand} wordmark`}>zeroguess</Link>
        <a className="btn btn-ghost btn-sm" href={`/public/shares/${token}/html`} target="_blank" rel="noreferrer">
          <Download size={14} aria-hidden="true" /> Offline copy
        </a>
      </header>
      <main className={styles.main}>
        <p className={styles.frozen}>
          Frozen on {fmtDateTime(s.frozen_at)}. This is a record of what was shown then; the documents may have changed since.
        </p>
        {s.report && (
          <div className={styles.seal}>
            <ShieldCheck size={18} strokeWidth={1.8} aria-hidden="true" />
            <p>
              <span className={styles.sealHead}>{tr('Signed report')} <span className="tnum">{s.report.id}</span></span>
              <span className={styles.sealBody}>
                {tr('Issued by {name} on {date}. Any change to a question, answer, quote or source document breaks the signature.', {
                  name: s.report.payload.issued_by.name + (s.report.payload.issued_by.domain ? ` (${s.report.payload.issued_by.domain})` : ''),
                  date: fmtDate(s.report.payload.issued_at),
                })}
              </span>
            </p>
            <Link to={`/verify/${s.report.id}`} className="btn btn-ghost btn-sm">{tr('Verify')} <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </div>
        )}
        <h1 className={styles.h1}>{s.title}</h1>
        {s.turns.map((t) => (
          <article key={t.turn} className={styles.turn}>
            <p className={styles.q}>{t.question}</p>
            <p className={styles.asof}>Rule in force on {fmtDate(t.as_of)}</p>
            <div className={styles.sheet}>
              <AnswerView answer={t.answer} cropFor={cropFor} onSelect={setOpen} selectedSentence={quote?.sentence_id} />
            </div>
          </article>
        ))}
        {quote && (
          <div className={styles.quoteBox} role="dialog" aria-label="Cited passage">
            <div className={styles.quoteHead}>
              <span>{quote.doc_title}{quote.clause_ref ? `, ${quote.clause_ref}` : ''}, page {quote.page}</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            {cropFor(quote.sentence_id) && <img className="crop" src={cropFor(quote.sentence_id)} alt="" />}
            <p>“{quote.quote}”</p>
          </div>
        )}
        {(open?.kind === 'conflict' || open?.kind === 'chain') && (
          <div className={`${styles.quoteBox} ${styles.wideBox}`} role="dialog" aria-label={open.kind === 'conflict' ? 'Conflicting clauses' : 'Every version of this rule'}>
            <div className={styles.quoteHead}>
              <span>{open.kind === 'conflict' ? 'Conflicting clauses' : 'Every version of this rule'}</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            {open.kind === 'conflict' ? <ConflictCard x={open.conflict} cropFor={cropFor} /> : <ChainStrip chain={open.chain} vertical />}
          </div>
        )}
      </main>
    </div>
  )
}
