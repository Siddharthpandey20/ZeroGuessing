import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { api, fileUrl, pageUrl } from '../lib/api'
import type { Chain, Citation, DocumentRow } from '../lib/types'
import { AsOfSlider } from './answer/AsOfSlider'
import { ChainStrip, ConflictCard, eventValue, keyValue } from './answer/AnswerView'
import { briefDoc, type CropFor, type Selection } from './answer/selection'
import styles from './Evidence.module.css'

export function Evidence({ selection, onClose, onSelect, cropFor }: {
  selection: Selection; onClose: () => void; onSelect: (s: Selection) => void; cropFor: CropFor
}) {
  if (!selection) return <EvidenceEmpty />
  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.kicker}>
          {selection.kind === 'citation' ? 'Source page' : selection.kind === 'conflict' ? 'Conflicting clauses' : 'Every version of this rule'}
        </span>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={onClose} aria-label="Close the evidence panel">
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.scroll}>
        {selection.kind === 'citation' && <PageView citation={selection.citation} highlight={selection.highlight} />}
        {selection.kind === 'conflict' && (
          <div className={styles.stack}>
            <ConflictCard x={selection.conflict} cropFor={cropFor} large />
            <div className={styles.pair}>
              {[selection.conflict.a, selection.conflict.b].map((s) => (
                <button key={s.sentence_id} type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect({ kind: 'citation', citation: { ...s, status: 'current' }, highlight: [s.sentence_id] })}>
                  Open {briefDoc(s.doc_title)}, page {s.page}
                </button>
              ))}
            </div>
          </div>
        )}
        {selection.kind === 'chain' && (
          <div className={styles.stack}>
            <ChainVersions chain={selection.chain} />
            <div className={styles.pair}>
              {selection.chain.events.filter((e) => e.sentence_id && e.page).map((e, i) => (
                <button key={i} type="button" className="btn btn-ghost btn-sm"
                  onClick={() => onSelect({
                    kind: 'citation',
                    citation: { sentence_id: e.sentence_id!, doc_id: (e.doc_id as string) ?? '', doc_title: e.doc_title ?? '', clause_ref: e.clause_ref ?? null, page: e.page!, quote: (e.quote || e.text || '') as string, bboxes: [], status: (e.state as string) ?? 'current' },
                    highlight: [e.sentence_id!],
                  })}
                  disabled={!e.doc_id && i > 0}
                >
                  {briefDoc(e.doc_title ?? '', 22)}{e.clause_ref ? `, ${e.clause_ref}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EvidenceEmpty() {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyHead}>Pick a citation to see the page it came from.</p>
      <ul className={styles.legend}>
        <li><span className={styles.swatch} data-k="proof" />Backed by a verbatim quote</li>
        <li><span className={styles.swatch} data-k="conflict" />Another clause disagrees</li>
        <li><span className={styles.swatch} data-k="blocked" />Blocked: no matching quote, or the clause is not in force</li>
      </ul>
      <p className={styles.emptyNote}>Hover any citation for a quick look. Click it to open the full page here.</p>
    </div>
  )
}

function PageView({ citation, highlight }: { citation: Citation; highlight: string[] }) {
  const docs = useQuery({ queryKey: ['documents'], queryFn: () => api<DocumentRow[]>('/api/documents') })
  const doc = docs.data?.find((d) => d.id === citation.doc_id)
  const [page, setPage] = useState(citation.page)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setPage(citation.page), [citation.sentence_id, citation.page])
  useEffect(() => setLoaded(false), [page, citation.doc_id])
  const count = doc?.page_count ?? citation.page
  const onCitedPage = page === citation.page
  const src = pageUrl(citation.doc_id, page, onCitedPage ? highlight : [], 144)

  return (
    <div className={styles.page}>
      <div className={styles.docHead}>
        <div className={styles.docTitle}>
          <span>{citation.doc_title}</span>
          <span className={styles.docMeta}>
            {citation.clause_ref ? `Clause ${citation.clause_ref}, ` : ''}page {citation.page}
            {citation.status && citation.status !== 'current' ? `, ${citation.status.replaceAll('_', ' ')} on the date asked` : ''}
          </span>
        </div>
        <a className="btn btn-quiet btn-icon btn-sm" href={`${fileUrl(citation.doc_id)}#page=${page}`} target="_blank" rel="noreferrer" aria-label="Open the PDF in a new tab">
          <ExternalLink size={15} strokeWidth={1.8} />
        </a>
      </div>

      <figure className={styles.sheet} data-loaded={loaded || undefined}>
        {!loaded && <div className={`skeleton ${styles.sheetSkel}`} aria-hidden="true" />}
        <img key={src} src={src} alt={`${citation.doc_title}, page ${page}${onCitedPage ? ', cited passage highlighted' : ''}`} onLoad={() => setLoaded(true)} decoding="async" />
      </figure>

      <div className={styles.pager}>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="tnum">Page {page} of {count}</span>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={page >= count} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
        {!onCitedPage && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPage(citation.page)}>Back to the cited page</button>
        )}
      </div>

      <blockquote className={styles.quote}>“{citation.quote}”</blockquote>
    </div>
  )
}

/** The date slider over a rule's history, with the timeline below it following the version under the thumb. */
function ChainVersions({ chain }: { chain: Chain }) {
  const today = new Date().toISOString().slice(0, 10)
  const [active, setActive] = useState<number | undefined>(undefined)
  useEffect(() => setActive(undefined), [chain])
  return (
    <>
      <AsOfSlider chain={chain} asOf={today} onVersion={setActive} value={(e) => keyValue(eventValue(e))} />
      <ChainStrip chain={chain} vertical active={active} />
    </>
  )
}
