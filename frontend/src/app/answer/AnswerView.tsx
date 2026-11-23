import { useId, useState } from 'react'
import { ArrowRightLeft, BadgeCheck, ChevronDown, CircleSlash, History, SearchX } from 'lucide-react'
import { CitationChip, type ChipSource } from '../../components/CitationChip'
import type { SegmentTone } from '../../components/FaithMeter'
import type { Answer, Calculation, Chain, Citation, Claim, Conflict } from '../../lib/types'
import { distinctChains, fmtDate, inr, shortDoc, type CropFor, type Selection } from './selection'
import { WorkTrace } from './WorkTrace'
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

interface Ref {
  n: number
  citation: Citation
  tone: 'proof' | 'conflict'
}

/** One number per quoted sentence, in reading order, shared by every claim that cites it. */
function numberCitations(claims: Claim[]): Map<string, Ref> {
  const refs = new Map<string, Ref>()
  for (const c of claims)
    for (const cit of c.citations)
      if (!refs.has(cit.sentence_id)) refs.set(cit.sentence_id, { n: refs.size + 1, citation: cit, tone: c.verdict === 'conflicted' ? 'conflict' : 'proof' })
  return refs
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const endWithStop = (s: string) => (/[.!?।]["”’)]*$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

/**
 * The answer reads as prose first; every proof stays one hover or click away: numbered markers (hover shows the
 * page crop, click opens the evidence panel), one-line notices for conflicts, amendments and blocked claims, and a
 * quiet footer with the as-of date, the sources and the faithfulness figure.
 */
export function AnswerView({ answer, cropFor, onSelect, selectedSentence, fresh }: Props) {
  const shown = answer.claims.filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted')
  const blocked = answer.claims.filter((c) => c.verdict === 'unsupported' || c.verdict === 'contradicted')
  const abstained = answer.status === 'abstained'
  // a timeline only explains an answer that was given; under "no proof" it is about some other rule
  const chains = abstained ? [] : distinctChains(answer.amendment_chains ?? [])
  const calcs = (answer.calculations ?? []).filter((c) => c && c.ok)
  const hindi = answer.lang === 'hi'
  const refs = numberCitations(shown)
  const selectCitation = (c: Citation) => onSelect?.({ kind: 'citation', citation: c, highlight: [c.sentence_id] })
  const hasNotices = answer.contradictions.length > 0 || chains.length > 0 || blocked.length > 0

  // a conversational reply (greeting, thanks, help): plain text, plainly marked as not from the documents
  if (answer.status === 'chat')
    return (
      <div className={styles.answer} data-status="chat" data-fresh={fresh || undefined}>
        <p className={styles.prose}>{answer.reply}</p>
        <footer className={styles.foot}>
          <p className={styles.footLine}><span>A reply, not from your documents. Ask a question to get quoted proof.</span></p>
        </footer>
      </div>
    )

  return (
    <div className={styles.answer} data-status={answer.status} data-fresh={fresh || undefined}>
      {!!answer.trace?.length && <WorkTrace steps={answer.trace} totalMs={answer.timings_ms?.total} cached={answer.cached} noProof={abstained} />}
      {answer.question_resolved && (
        <p className={styles.readAs}><span>Read as:</span> {answer.question_resolved}</p>
      )}
      {answer.overview && <p className={styles.readAs}>An overview built from the documents themselves: their section headings, or their opening line.</p>}
      {abstained && answer.abstention && (
        <Abstention answer={answer} cropFor={cropFor} selectedSentence={selectedSentence} onCite={selectCitation} />
      )}

      {shown.length > 0 && (
        // an overview is one line per document, so it reads as a list; an answer reads as prose
        <ProseOrList list={!!answer.overview} lang={hindi ? 'hi' : undefined}>
          {shown.map((c, i) => (
            <ItemOf key={i} list={!!answer.overview}>
              <span className={styles.claim} data-verdict={c.verdict} data-active={c.citations.some((x) => x.sentence_id === selectedSentence) || undefined}>
                {endWithStop(hindi && c.text_hi ? c.text_hi : c.text)}
              </span>
              {c.citations.map((cit) => {
                const r = refs.get(cit.sentence_id)!
                return (
                  <CitationChip key={cit.sentence_id} n={r.n} tone={r.tone} source={toChip(cit, cropFor)}
                    active={selectedSentence === cit.sentence_id} onSelect={() => selectCitation(cit)} />
                )
              })}{' '}
            </ItemOf>
          ))}
        </ProseOrList>
      )}

      {hindi && shown.some((c) => c.text_hi) && (
        <Disclosure label="Show the English original" kind="original">
          <p className={styles.original}>{shown.map((c) => endWithStop(c.text)).join(' ')}</p>
        </Disclosure>
      )}

      {calcs.map((calc, i) => <CalcCard key={i} calc={calc} />)}

      {!abstained && <Verdict answer={answer} shown={shown.length} blocked={blocked.length} />}

      {hasNotices && (
        <ul className={styles.notices}>
          {conflictGroups(answer.contradictions).map(([line, xs]) => (
            <li key={xs[0].id} className={styles.notice} data-tone="conflict">
              <ArrowRightLeft size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>
                {xs.length > 1 ? `${line.slice(0, -1)}, in ${xs.length} places.` : line}{' '}
                {xs.map((x, k) => (
                  <span key={x.id}>
                    {k > 0 && <span aria-hidden="true"> · </span>}
                    <button type="button" className={styles.link} data-open="conflict" onClick={() => onSelect?.({ kind: 'conflict', conflict: x })}>
                      {k === 0 ? 'Compare' : k + 1}
                      <span className="sr-only">{xs.length > 1 ? ` pair ${k + 1}` : ''} side by side</span>
                    </button>
                  </span>
                ))}
              </span>
            </li>
          ))}
          {chains.map((ch) => (
            <li key={ch.key} className={styles.notice} data-tone="chain">
              <History size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>
                {chainLine(ch)}{' '}
                <button type="button" className={styles.link} data-open="chain" onClick={() => onSelect?.({ kind: 'chain', chain: ch })}>
                  See timeline<span className="sr-only"> of every version</span>
                </button>
              </span>
            </li>
          ))}
          {blocked.length > 0 && (
            <li className={styles.notice} data-tone="blocked">
              <CircleSlash size={15} strokeWidth={1.8} aria-hidden="true" />
              <Disclosure label={`${plural(blocked.length, 'claim')} ${blocked.length === 1 ? 'was' : 'were'} blocked.`} action="Show why" kind="blocked">
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
              </Disclosure>
            </li>
          )}
        </ul>
      )}

      <Footer answer={answer} refs={refs} selectedSentence={selectedSentence} onCite={selectCitation} />
    </div>
  )
}

function ProseOrList({ list, lang, children }: { list: boolean; lang?: string; children: React.ReactNode }) {
  return list ? <ul className={styles.overview} lang={lang}>{children}</ul> : <p className={styles.prose} lang={lang}>{children}</p>
}

function ItemOf({ list, children }: { list: boolean; children: React.ReactNode }) {
  return list ? <li className={styles.claimWrap}>{children}</li> : <span className={styles.claimWrap}>{children}</span>
}

function conflictLine(x: Conflict) {
  const what = `${x.subject.toLowerCase()}${x.attribute ? ` (${x.attribute})` : ''}`
  return x.scope === 'intra' || x.a.doc_id === x.b.doc_id
    ? `Two clauses in one document disagree on ${what}.`
    : `Two documents disagree on ${what}.`
}

/** Pairs that would read as the same sentence share one line, with a numbered link per pair. */
function conflictGroups(xs: Conflict[]): [string, Conflict[]][] {
  const groups = new Map<string, Conflict[]>()
  for (const x of xs) {
    const line = conflictLine(x)
    groups.set(line, [...(groups.get(line) ?? []), x])
  }
  return [...groups]
}

const TIMES = ['', 'once', 'twice']

/** "Clause 7.2 changed twice: 2% → 1% → Nil, in force since 1 Jul 2026." */
function chainLine(ch: Chain) {
  const ev = ch.events
  const changes = ev.length - 1
  const vals = ev.map((e) => keyValue(eventValue(e)))
  const path = vals.every(Boolean) ? vals.filter((v, i) => i === 0 || v !== vals[i - 1]).join(' → ') : null
  const current = ev.find((e) => e.state === 'current') ?? ev[ev.length - 1]
  const since = current?.effective_date ? `, in force since ${fmtDate(current.effective_date)}` : ''
  return `The rule changed ${TIMES[changes] ?? `${changes} times`}${path ? `: ${path}` : ''}${since}.`
}

/** The figure a version sets ("2%", "₹500", "Nil"), when it states one. */
export function keyValue(t: string): string | null {
  if (/\bnil\b|\bno\s+(?:prepayment\s+|foreclosure\s+)?(?:penalty|charge|fee)s?\b/i.test(t)) return 'Nil'
  const m = t.match(/₹\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%/)
  return m ? m[0].replace(/\s/g, '') : null
}

function Abstention({ answer, cropFor, selectedSentence, onCite }: {
  answer: Answer; cropFor: CropFor; selectedSentence?: string | null; onCite: (c: Citation) => void
}) {
  const a = answer.abstention!
  return (
    <section className={styles.abstain} aria-label="No proof">
      <p className={styles.abstainHead}>
        <CircleSlash size={20} strokeWidth={1.8} aria-hidden="true" /> I don’t have proof for this.
      </p>
      <p className={styles.abstainLead}>Nothing was guessed. No passage in this chat’s documents states the answer, so no claim was shown.</p>
      {a.missing.length > 0 && (
        <div className={styles.settle}>
          <p className={styles.settleHead}>What would settle it</p>
          <ul className={styles.settleList}>
            {a.missing.map((m, i) => <li key={i}>{endWithStop(sentenceCase(m))}</li>)}
          </ul>
        </div>
      )}
      {(answer.searched || a.closest.length > 0) && (
        <Disclosure label="What I searched" kind="searched">
          <dl className={styles.facts}>
            {answer.searched && (
              <div>
                <dt>Searched</dt>
                <dd>{plural(answer.searched.docs, 'document')} for “{answer.searched.terms.join(' ')}”</dd>
              </div>
            )}
            {a.closest.length > 0 && (
              <div>
                <dt>Closest</dt>
                <dd className={styles.closest}>
                  {a.closest.map((c) => (
                    <CitationChip key={c.sentence_id} tone="plain" source={toChip(c, cropFor)} active={selectedSentence === c.sentence_id} onSelect={() => onCite(c)} />
                  ))}
                  <span className={styles.closestNote}>Related passages that do not state the answer.</span>
                </dd>
              </div>
            )}
          </dl>
        </Disclosure>
      )}
    </section>
  )
}

function Footer({ answer, refs, selectedSentence, onCite }: {
  answer: Answer; refs: Map<string, Ref>; selectedSentence?: string | null; onCite: (c: Citation) => void
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const list = [...refs.values()]
  const docs = new Set(list.map((r) => r.citation.doc_id)).size
  const segs = answer.claims.map((c) => c.verdict as SegmentTone)
  const backed = segs.filter((s) => s === 'supported' || s === 'conflicted').length
  const pct = answer.faithfulness?.pct
  return (
    <footer className={styles.foot}>
      <p className={styles.footLine}>
        {list.length > 0 ? (
          <button type="button" className={styles.footBtn} aria-expanded={open} aria-controls={listId} data-open="sources" onClick={() => setOpen((v) => !v)}>
            Backed by {plural(list.length, 'quote')} from {plural(docs, 'document')}
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className={styles.chev} />
          </button>
        ) : (
          <span>Checked against the rules</span>
        )}
        <span>in force on {fmtDate(answer.as_of)}</span>
        {segs.length > 0 && typeof pct === 'number' && (
          <span className={styles.faith} title={`${backed} of ${segs.length} drafted claims backed by a verbatim quote${segs.length - backed ? `; ${segs.length - backed} blocked` : ''}`}>
            <span className={styles.faithTrack} role="img" aria-label={`${backed} of ${segs.length} drafted claims backed by a quote`}>
              {segs.map((s, i) => <span key={i} data-tone={s} />)}
            </span>
            <span><span className="tnum">{Math.round(pct)}%</span> faithful</span>
          </span>
        )}
      </p>
      {open && (
        <ol className={styles.sources} id={listId}>
          {list.map((r) => (
            <li key={r.citation.sentence_id}>
              <button type="button" className={styles.source} data-tone={r.tone} data-active={selectedSentence === r.citation.sentence_id || undefined} onClick={() => onCite(r.citation)}>
                <span className={styles.sourceN}>{r.n}</span>
                <span className={styles.sourceDoc}>{shortDoc(r.citation.doc_title)}</span>
                <span className={styles.sourceWhere}>{r.citation.clause_ref ? `${r.citation.clause_ref}, ` : ''}p.{r.citation.page}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </footer>
  )
}

/** A quiet show/hide. With `action`, the label reads as a sentence and the toggle follows it. */
function Disclosure({ label, action, kind, children }: { label: string; action?: string; kind: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={styles.disclosure}>
      <span>
        {action && <>{label} </>}
        <button type="button" className={styles.link} aria-expanded={open} aria-controls={id} data-open={kind} onClick={() => setOpen((v) => !v)}>
          {action ? (open ? 'Hide' : action) : label}
          <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className={styles.chev} />
        </button>
      </span>
      {open && <div id={id} className={styles.disclosed}>{children}</div>}
    </div>
  )
}

function CalcCard({ calc }: { calc: Calculation }) {
  const unitLabel = calc.formula.toLowerCase().includes('emi') ? 'per month' : ''
  return (
    <section className={styles.calc} aria-label="Calculation">
      {calc.result !== null && (
        <p className={styles.result}>
          <span className="tnum">{calc.unit === 'INR' ? inr(calc.result) : calc.result}</span>
          {unitLabel && <span className={styles.resultUnit}>{unitLabel}</span>}
        </p>
      )}
      <Disclosure label="How it was worked out" kind="calc">
        <code className={`${styles.formula} readout`}>{calc.formula}</code>
        <ol className={styles.steps}>
          {calc.steps.map((s, i) => (
            <li key={i}><span className="readout muted">{i + 1}</span><span className="tnum">{s}</span></li>
          ))}
        </ol>
        <p className={styles.calcNote}>Computed in code from the cited figures, not by the model.</p>
      </Disclosure>
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

export function eventValue(e: Chain['events'][number]) {
  return (e.new_text || e.text || e.quote || '').trim()
}

const STATE_WORD: Record<string, string> = { current: 'In force', superseded: 'Superseded', not_yet_effective: 'Not yet in force', pending: 'Not yet in force', deleted: 'Deleted' }

/** One rule's history, oldest first: which document said what, from when, and which version applies on the date asked. */
export function ChainStrip({ chain, onOpen, vertical, active }: { chain: Chain; onOpen?: () => void; vertical?: boolean; active?: number }) {
  return (
    <div className={styles.chain} data-full={vertical || undefined}>
      <ol className={styles.chainList}>
        {chain.events.map((e, i) => {
          const state = (e.state as string) || 'superseded'
          return (
            <li key={i} data-state={state} data-active={active === i || undefined}>
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

/**
 * The verdict in one tinted box, read before the details: green when every shown claim is backed by a quote,
 * amber when the documents disagree, red when part of the question has no proof (and what would settle it).
 */
function Verdict({ answer, shown, blocked }: { answer: Answer; shown: number; blocked: number }) {
  if (answer.status === 'chat' || shown === 0) return null
  const missing = answer.abstention?.missing ?? []
  const gaps = missing.length > 0
  return (
    <div className={styles.verdicts}>
      {answer.status === 'conflicted' ? (
        <div className={styles.callout} data-tone="conflict" role="note">
          <ArrowRightLeft size={16} strokeWidth={2} aria-hidden="true" />
          <div>
            <p className={styles.calloutHead}>Your documents disagree on this</p>
            <p className={styles.calloutBody}>Each side is quoted word for word. Compare them before relying on the answer.</p>
          </div>
        </div>
      ) : !gaps && blocked === 0 ? (
        <div className={styles.callout} data-tone="proof" role="note">
          <BadgeCheck size={16} strokeWidth={2} aria-hidden="true" />
          <div>
            <p className={styles.calloutHead}>Verified against your documents</p>
            <p className={styles.calloutBody}>
              {shown === 1 ? 'The claim is' : `All ${shown} claims are`} backed by a verbatim quote, with every number checked,
              under the rules in force on {fmtDate(answer.as_of)}.
            </p>
          </div>
        </div>
      ) : null}
      {gaps && (
        <div className={styles.callout} data-tone="gap" role="note">
          <SearchX size={16} strokeWidth={2} aria-hidden="true" />
          <div>
            <p className={styles.calloutHead}>Part of this is not in your documents</p>
            <p className={styles.calloutBody}>What is shown above is proven. For the rest there is no proof, so nothing was guessed:</p>
            <ul className={styles.settleList}>
              {missing.map((m, i) => <li key={i}>{endWithStop(sentenceCase(m))}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
