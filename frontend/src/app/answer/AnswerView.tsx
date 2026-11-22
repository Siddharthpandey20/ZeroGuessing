import { ArrowRightLeft, CircleSlash, History, Sigma } from 'lucide-react'
import { CitationChip, type ChipSource } from '../../components/CitationChip'
import { FaithMeter, type SegmentTone } from '../../components/FaithMeter'
import type { Answer, Calculation, Chain, Citation, Claim, Conflict } from '../../lib/types'
import { distinctChains, fmtDate, inr, shortDoc, STATUS_LABEL, type CropFor, type Selection } from './selection'
import styles from './AnswerView.module.css'

interface Props {
  answer: Answer
  cropFor: CropFor
  onSelect?: (s: Selection) => void
  selectedSentence?: string | null
  fresh?: boolean
}

export function toChip(c: Citation, cropFor: CropFor): ChipSource {
  return {
    docTitle: shortDoc(c.doc_title),
    clause: c.clause_ref ? (/^\d/.test(c.clause_ref) && c.doc_title.toLowerCase().startsWith('circular') ? `¶${c.clause_ref}` : c.clause_ref) : null,
    page: c.page,
    quote: c.quote,
    img: cropFor(c.sentence_id),
    status: c.status,
    statusNote: c.status !== 'current' ? c.status_note : null,
  }
}

export function AnswerView({ answer, cropFor, onSelect, selectedSentence, fresh }: Props) {
  const shown = answer.claims.filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted')
  const blocked = answer.claims.filter((c) => c.verdict === 'unsupported' || c.verdict === 'contradicted')
  const segments = answer.claims.map((c) => c.verdict as SegmentTone)
  const chains = distinctChains(answer.amendment_chains ?? [])
  const calcs = (answer.calculations ?? []).filter((c) => c && c.ok)
  const hindi = answer.lang === 'hi'
  const selectCitation = (c: Citation) => onSelect?.({ kind: 'citation', citation: c, highlight: [c.sentence_id] })

  return (
    <div className={styles.answer} data-status={answer.status}>
      <div className={styles.statusRow}>
        <span className={styles.status} data-status={answer.status}>
          <span className={styles.statusDot} aria-hidden="true" />
          {STATUS_LABEL[answer.status] ?? answer.status}
        </span>
        <span className={styles.meta}>
          Rule in force on {fmtDate(answer.as_of)}
          {answer.searched ? `, ${answer.searched.docs} documents searched` : ''}
          {answer.cached ? ', from cache' : answer.timings_ms?.total ? `, ${(answer.timings_ms.total / 1000).toFixed(1)} s` : ''}
        </span>
      </div>

      {answer.status === 'abstained' && answer.abstention && (
        <section className={styles.abstain} aria-label="No proof">
          <p className={styles.abstainHead}>
            <CircleSlash size={20} strokeWidth={1.8} aria-hidden="true" /> I don’t have proof for this.
          </p>
          <dl className={styles.facts}>
            {answer.abstention.missing.length > 0 && (
              <div>
                <dt>Missing</dt>
                <dd>
                  <ul>{answer.abstention.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
                </dd>
              </div>
            )}
            {answer.searched && (
              <div>
                <dt>Searched</dt>
                <dd>
                  {answer.searched.docs} documents for “{answer.searched.terms.join(' ')}”
                </dd>
              </div>
            )}
            {answer.abstention.closest.length > 0 && (
              <div>
                <dt>Closest</dt>
                <dd className={styles.closest}>
                  {answer.abstention.closest.map((c) => (
                    <CitationChip key={c.sentence_id} tone="plain" source={toChip(c, cropFor)} active={selectedSentence === c.sentence_id} onSelect={() => selectCitation(c)} />
                  ))}
                  <span className={styles.closestNote}>These passages are related but do not state the answer.</span>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {shown.length > 0 && (
        <ol className={styles.claims}>
          {shown.map((c, i) => (
            <ClaimLine key={i} claim={c} i={i} hindi={hindi} fresh={fresh} cropFor={cropFor} selectedSentence={selectedSentence} onCite={selectCitation}
              onConflict={() => {
                const x = answer.contradictions.find((k) => c.conflict_ids?.includes(k.id))
                if (x) onSelect?.({ kind: 'conflict', conflict: x })
              }}
            />
          ))}
        </ol>
      )}

      {calcs.map((calc, i) => <CalcCard key={i} calc={calc} />)}

      {answer.contradictions.length > 0 && (
        <section className={styles.block} aria-label="Conflicts">
          <h3 className={styles.blockHead}><ArrowRightLeft size={15} strokeWidth={1.8} aria-hidden="true" /> The documents disagree</h3>
          {answer.contradictions.map((x) => (
            <ConflictCard key={x.id} x={x} cropFor={cropFor} onOpen={() => onSelect?.({ kind: 'conflict', conflict: x })} onCite={selectCitation} selectedSentence={selectedSentence} />
          ))}
        </section>
      )}

      {chains.length > 0 && (
        <section className={styles.block} aria-label="Amendment chain">
          <h3 className={styles.blockHead}><History size={15} strokeWidth={1.8} aria-hidden="true" /> How this rule changed</h3>
          {chains.map((ch) => <ChainStrip key={ch.key} chain={ch} onOpen={() => onSelect?.({ kind: 'chain', chain: ch })} />)}
        </section>
      )}

      {blocked.length > 0 && (
        <section className={styles.block} aria-label="Blocked claims">
          <h3 className={styles.blockHead}><CircleSlash size={15} strokeWidth={1.8} aria-hidden="true" /> Blocked before display</h3>
          <ol className={styles.blocked}>
            {blocked.map((c, i) => (
              <li key={i}>
                <span className="struck">{hindi && c.text_hi ? c.text_hi : c.text}</span>
                {c.citations.map((cit) => (
                  <CitationChip key={cit.sentence_id} tone="blocked" source={toChip(cit, cropFor)} active={selectedSentence === cit.sentence_id} onSelect={() => selectCitation(cit)} />
                ))}
                {c.reason && <span className={styles.reason}>{sentenceCase(c.reason)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {answer.claims.length > 0 && (
        <div className={styles.faith}>
          <FaithMeter segments={segments} pct={answer.faithfulness?.pct ?? null} />
        </div>
      )}
    </div>
  )
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function ClaimLine({ claim, i, hindi, fresh, cropFor, selectedSentence, onCite, onConflict }: {
  claim: Claim; i: number; hindi: boolean; fresh?: boolean; cropFor: CropFor; selectedSentence?: string | null
  onCite: (c: Citation) => void; onConflict: () => void
}) {
  const conflicted = claim.verdict === 'conflicted'
  const text = hindi && claim.text_hi ? claim.text_hi : claim.text
  return (
    <li className={`${styles.claim}${fresh ? ` ${styles.enter}` : ''}`} style={fresh ? { animationDelay: `${80 * i}ms` } : undefined}>
      <span className={`${styles.mark}${conflicted ? ` ${styles.markConflict}` : ''}${fresh ? ` ${styles.sweep}` : ''}`} style={fresh ? { animationDelay: `${120 + 80 * i}ms` } : undefined}>
        {text}
      </span>{' '}
      {claim.citations.map((c) => (
        <CitationChip key={c.sentence_id} tone={conflicted ? 'conflict' : 'proof'} source={toChip(c, cropFor)} active={selectedSentence === c.sentence_id} onSelect={() => onCite(c)} />
      ))}
      {hindi && claim.text_hi && <span className={styles.original}>{claim.text}</span>}
      {conflicted && (
        <button type="button" className={styles.conflictLink} onClick={onConflict}>
          Compare the conflicting quotes
        </button>
      )}
    </li>
  )
}

function CalcCard({ calc }: { calc: Calculation }) {
  const unitLabel = calc.formula.toLowerCase().includes('emi') ? 'per month' : ''
  return (
    <section className={styles.calc} aria-label="Calculation">
      <div className={styles.calcHead}>
        <span className={styles.blockHead}><Sigma size={15} strokeWidth={1.8} aria-hidden="true" /> Worked out in code from the cited figures</span>
        <code className={`${styles.formula} readout`}>{calc.formula}</code>
      </div>
      <ol className={styles.steps}>
        {calc.steps.map((s, i) => (
          <li key={i}><span className="readout muted">{i + 1}</span><span className="tnum">{s}</span></li>
        ))}
      </ol>
      {calc.result !== null && (
        <p className={styles.result}>
          <span className="tnum">{calc.unit === 'INR' ? inr(calc.result) : calc.result}</span>
          {unitLabel && <span className={styles.resultUnit}>{unitLabel}</span>}
        </p>
      )}
    </section>
  )
}

export function ConflictCard({ x, cropFor, onOpen, onCite, selectedSentence, large }: {
  x: Conflict; cropFor: CropFor; onOpen?: () => void; onCite?: (c: Citation) => void; selectedSentence?: string | null; large?: boolean
}) {
  const side = (s: Conflict['a']) => {
    const cit: Citation = { ...s, status: 'current' }
    return (
      <div className={styles.side}>
        <span className={styles.sideDoc}>{shortDoc(s.doc_title)}{s.clause_ref ? `, ${s.clause_ref}` : ''}, p.{s.page}</span>
        {s.value && s.value.trim().length > 1 && <span className={`${styles.mark} ${styles.markConflict} ${styles.sideValue}`}>{s.value}</span>}
        {large ? <img className="crop" src={cropFor(s.sentence_id)} alt={`${s.doc_title}, page ${s.page}`} loading="lazy" /> : <p className={styles.sideQuote}>“{s.quote}”</p>}
        {onCite && (
          <CitationChip tone="conflict" source={toChip(cit, cropFor)} active={selectedSentence === s.sentence_id} onSelect={() => onCite(cit)} />
        )}
      </div>
    )
  }
  return (
    <div className={styles.conflict} data-large={large || undefined}>
      <div className={styles.conflictHead}>
        <span className={styles.conflictSubject}>{sentenceCase(x.subject)}{x.attribute ? `: ${x.attribute}` : ''}</span>
        <span className={styles.kind}>{x.kind}, {x.scope === 'intra' ? 'same document' : 'across documents'}</span>
      </div>
      <div className={styles.sides}>
        {side(x.a)}
        <span className={styles.neq} aria-label="does not match">≠</span>
        {side(x.b)}
      </div>
      {x.explanation && <p className={styles.explain}>{sentenceCase(x.explanation)}</p>}
      {onOpen && !large && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onOpen}>See both pages</button>
      )}
    </div>
  )
}

function eventValue(e: Chain['events'][number]) {
  return (e.new_text || e.text || e.quote || '').trim()
}

const STATE_WORD: Record<string, string> = { current: 'In force', superseded: 'Superseded', not_yet_effective: 'Not yet in force', pending: 'Not yet in force', deleted: 'Deleted' }

/** One rule's history, oldest first: which document said what, from when, and which version applies on the date asked. */
export function ChainStrip({ chain, onOpen, vertical }: { chain: Chain; onOpen?: () => void; vertical?: boolean }) {
  return (
    <div className={styles.chain} data-full={vertical || undefined}>
      <ol className={styles.chainList}>
        {chain.events.map((e, i) => {
          const state = (e.state as string) || 'superseded'
          return (
            <li key={i} data-state={state}>
              <span className={styles.chainNode} aria-hidden="true" />
              <div className={styles.chainRow}>
                <span className={styles.chainDoc}>{shortDoc(e.doc_title ?? '')}{e.clause_ref ? `, ${e.clause_ref}` : ''}</span>
                <span className={styles.chainState} data-state={state}>{STATE_WORD[state] ?? state}</span>
              </div>
              <span className={styles.chainWhen}>{e.effective_date ? `Effective ${fmtDate(e.effective_date)}` : i === 0 ? 'Original text' : 'Date not stated'}</span>
              {eventValue(e) && <span className={styles.chainText}>“{eventValue(e)}”</span>}
            </li>
          )
        })}
      </ol>
      {onOpen && !vertical && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onOpen}>Open each version’s page</button>
      )}
    </div>
  )
}
