import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileUp, RotateCw, ScanSearch, X } from 'lucide-react'
import { api, ApiError, pageUrl, patch, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Amendment, ClauseRow, DocumentRow } from '../lib/types'
import { fmtDate, fmtDateTime, shortDoc } from './answer/selection'
import styles from './Library.module.css'

interface UploadResult { filename: string; document_id: string | null; job_id: string | null; status: 'queued' | 'duplicate' | 'rejected'; detail: string | null }

const TYPE_LABEL: Record<string, string> = { master: 'Master policy', circular: 'Circular', contract: 'Contract', kfs: 'Key facts', policy: 'Policy wording', schedule: 'Schedule', other: 'Other' }
const ready = (s: string) => s.startsWith('indexed')
const statusWord = (d: DocumentRow) =>
  d.ingest_status === 'failed' ? 'Failed' : ready(d.ingest_status) ? (d.ingest_status === 'indexed_no_vectors' ? 'Keyword search only' : 'Indexed') : d.ingest_status === 'queued' ? 'Queued' : 'Reading'

export default function Library() {
  const { docId } = useParams()
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [uploads, setUploads] = useState<UploadResult[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const docs = useQuery({
    queryKey: ['documents'],
    queryFn: () => api<DocumentRow[]>('/api/documents'),
    refetchInterval: (q) => (q.state.data?.some((d) => !ready(d.ingest_status) && d.ingest_status !== 'failed') ? 1500 : false),
  })
  const amendments = useQuery({ queryKey: ['amendments'], queryFn: () => api<Amendment[]>('/api/amendments') })
  const proposed = amendments.data?.filter((a) => a.status === 'proposed') ?? []

  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      return api<UploadResult[]>('/api/documents', { method: 'POST', body: fd })
    },
    onMutate: (files) => setUploads(files.map((f) => ({ filename: f.name, document_id: null, job_id: null, status: 'queued', detail: 'Uploading' }))),
    onSuccess: (r) => {
      setUploads(r)
      qc.invalidateQueries({ queryKey: ['documents'] })
    },
    onError: (e) => setUploads([{ filename: 'Upload', document_id: null, job_id: null, status: 'rejected', detail: e instanceof ApiError ? e.message : 'Upload failed' }]),
  })
  const scan = useMutation({ mutationFn: () => post('/api/alerts/scan'), onSuccess: () => window.setTimeout(() => qc.invalidateQueries({ queryKey: ['alerts'] }), 2500) })

  // finishing ingestion changes amendments and alerts too
  const processing = docs.data?.filter((d) => !ready(d.ingest_status) && d.ingest_status !== 'failed').length ?? 0
  const wasProcessing = useRef(0)
  useEffect(() => {
    if (wasProcessing.current > 0 && processing === 0) {
      qc.invalidateQueries({ queryKey: ['amendments'] })
      qc.invalidateQueries({ queryKey: ['alerts'] })
    }
    wasProcessing.current = processing
  }, [processing, qc])

  const pick = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (files.length) upload.mutate(files)
  }

  const selected = docs.data?.find((d) => d.id === docId)
  const total = docs.data?.length ?? 0

  return (
    <div
      className={styles.lib}
      data-detail={docId ? 'open' : undefined}
      onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={(e) => { if (isAdmin) { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files) } }}
    >
      <section className={styles.main} aria-labelledby="lib-title">
        <header className={styles.head}>
          <div>
            <h1 id="lib-title" className={styles.h1}>Library</h1>
            <p className={styles.sub}>
              {docs.isLoading ? 'Loading documents' : `${total} ${total === 1 ? 'document' : 'documents'}${processing ? `, ${processing} being read` : ''}. Only documents in use are searched.`}
            </p>
          </div>
          {isAdmin && (
            <div className={styles.headActions}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
                <ScanSearch size={15} strokeWidth={1.8} aria-hidden="true" /> {scan.isSuccess ? 'Scan started' : 'Check for conflicts'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => file.current?.click()} disabled={upload.isPending}>
                <FileUp size={15} strokeWidth={1.8} aria-hidden="true" /> Add PDFs
              </button>
              <input ref={file} type="file" accept="application/pdf" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
            </div>
          )}
        </header>

        {uploads && (
          <div className={styles.uploads} role="status">
            <ul>
              {uploads.map((u, i) => (
                <li key={i} data-status={u.status}>
                  <span className={styles.uName}>{u.filename}</span>
                  <span className={styles.uState}>{u.detail === 'Uploading' ? 'Uploading' : u.status === 'queued' ? 'Added, now reading' : u.status === 'duplicate' ? 'Already in the library' : `Not added: ${u.detail}`}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => setUploads(null)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}

        {proposed.length > 0 && (
          <div className={styles.review}>
            <p><strong>{proposed.length} {proposed.length === 1 ? 'amendment needs' : 'amendments need'} a person to confirm.</strong> They are not applied until confirmed.</p>
            <ul className={styles.reviewList}>
              {proposed.map((a) => <AmendmentRow key={a.id} a={a} admin={isAdmin} />)}
            </ul>
          </div>
        )}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Type</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Status</th>
                <th scope="col" className={styles.num}>Clauses</th>
                <th scope="col" className={styles.num}>Amends</th>
                <th scope="col" className={styles.num}>Conflicts</th>
              </tr>
            </thead>
            <tbody>
              {docs.isLoading && [0, 1, 2, 3, 4].map((i) => (
                <tr key={i} className={styles.skelRow}><td colSpan={7}><span className="skeleton" /></td></tr>
              ))}
              {docs.data?.map((d) => (
                <tr key={d.id} data-selected={d.id === docId || undefined} data-off={!d.active || undefined} onClick={() => nav(`/app/library/${d.id}`)}>
                  <td>
                    <Link to={`/app/library/${d.id}`} className={styles.docLink} onClick={(e) => e.stopPropagation()}>{d.title}</Link>
                    <span className={styles.file}>{d.filename}{!d.active ? ', not in use' : ''}</span>
                  </td>
                  <td>{TYPE_LABEL[d.doc_type] ?? d.doc_type}</td>
                  <td className="tnum">{fmtDate(d.uploaded_at, { day: 'numeric', month: 'short' })}</td>
                  <td><span className={styles.status} data-s={d.ingest_status === 'failed' ? 'failed' : ready(d.ingest_status) ? 'ready' : 'busy'}>{statusWord(d)}</span></td>
                  <td className={`${styles.num} tnum`}>{d.n_clauses}</td>
                  <td className={`${styles.num} tnum`}>{d.n_amendments_confirmed}{d.n_amendments_proposed ? <span className={styles.pendingN}> +{d.n_amendments_proposed}</span> : ''}</td>
                  <td className={`${styles.num} tnum`}>{d.n_alerts ? <span className={styles.alertN}>{d.n_alerts}</span> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.isLoading && !total && (
            <div className={styles.emptyTable}>
              <p className={styles.emptyHead}>No documents yet.</p>
              <p>{isAdmin ? 'Add loan agreements, circulars or policy PDFs. Drop them anywhere on this page.' : 'An admin needs to add documents before questions can be answered.'}</p>
            </div>
          )}
        </div>
      </section>

      <aside className={styles.detail} aria-label="Document details">
        {selected ? <DocDetail doc={selected} admin={isAdmin} amendments={amendments.data ?? []} onClose={() => nav('/app/library')} /> : docId ? <p className={styles.detailEmpty}>Loading</p> : null}
      </aside>

      {dragging && <div className={styles.drop} aria-hidden="true"><span>Drop PDFs to add them to the library</span></div>}
    </div>
  )
}

function AmendmentRow({ a, admin }: { a: Amendment; admin: boolean }) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (status: 'confirmed' | 'rejected') => patch(`/api/amendments/${a.id}`, { status }),
    onSuccess: () => ['amendments', 'documents', 'alerts', 'chats'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
  return (
    <li className={styles.amend} data-status={a.status}>
      <div className={styles.amendText}>
        <span className={styles.amendWho}>
          {shortDoc(a.source_doc_title ?? 'A document')}{a.source_clause_ref ? `, ${a.source_clause_ref}` : ''}
          {' '}{a.action === 'substitute' ? 'replaces' : a.action === 'insert' ? 'adds to' : a.action === 'delete' ? 'deletes' : 'withdraws'}{' '}
          {shortDoc(a.target_doc_title ?? a.target_doc_ref ?? 'an unresolved document')}{a.target_clause_ref ? `, ${a.target_clause_ref}` : ''}
        </span>
        <span className={styles.amendWhen}>
          {a.effective_date ? `Effective ${fmtDate(a.effective_date)}` : 'Effective date not stated'}
          {a.confidence !== null ? `, extraction confidence ${Math.round(a.confidence * 100)}%` : ''}
        </span>
        {a.new_text && <span className={styles.amendNew}>“{a.new_text}”</span>}
      </div>
      {admin && a.status === 'proposed' && (
        <div className={styles.amendActions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => m.mutate('rejected')} disabled={m.isPending}><X size={14} aria-hidden="true" /> Reject</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => m.mutate('confirmed')} disabled={m.isPending}><Check size={14} aria-hidden="true" /> Confirm</button>
        </div>
      )}
      {a.status !== 'proposed' && <span className={styles.amendStatus} data-status={a.status}>{a.status === 'confirmed' ? 'Applied' : 'Rejected'}</span>}
    </li>
  )
}

function DocDetail({ doc, admin, amendments, onClose }: { doc: DocumentRow; admin: boolean; amendments: Amendment[]; onClose: () => void }) {
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: ['document', doc.id], queryFn: () => api<{ clauses: ClauseRow[] }>(`/api/documents/${doc.id}`) })
  const toggle = useMutation({
    mutationFn: () => patch(`/api/documents/${doc.id}`, { active: !doc.active }),
    onSuccess: () => ['documents', 'alerts', 'chats'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
  const reingest = useMutation({ mutationFn: () => post(`/api/documents/${doc.id}/reingest`), onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }) })
  const related = amendments.filter((a) => a.source_doc_id === doc.id || a.target_doc_id === doc.id)

  return (
    <div className={styles.dPanel}>
      <div className={styles.dHead}>
        <span className={styles.dKicker}>{TYPE_LABEL[doc.doc_type] ?? doc.doc_type}{doc.circular_no ? `, ${doc.circular_no}` : ''}</span>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={onClose} aria-label="Close details"><X size={16} /></button>
      </div>
      <div className={styles.dScroll}>
        <h2 className={styles.dTitle}>{doc.title}</h2>
        <dl className={styles.dFacts}>
          <div><dt>Issued</dt><dd>{doc.issue_date ? fmtDate(doc.issue_date) : 'Not stated'}</dd></div>
          <div><dt>Issuer</dt><dd>{doc.issuer ?? 'Not stated'}</dd></div>
          <div><dt>Uploaded</dt><dd>{fmtDateTime(doc.uploaded_at)}</dd></div>
          <div><dt>Indexed</dt><dd>{doc.ingested_at ? fmtDateTime(doc.ingested_at) : statusWord(doc)}</dd></div>
          <div><dt>Size</dt><dd className="tnum">{doc.page_count} {doc.page_count === 1 ? 'page' : 'pages'}, {(doc.file_size / 1024).toFixed(0)} KB</dd></div>
        </dl>
        {doc.ingest_error && <p className={styles.dError}>{doc.ingest_error}</p>}

        {admin && (
          <div className={styles.dActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
              {doc.active ? 'Stop using this document' : 'Use this document again'}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => reingest.mutate()} disabled={reingest.isPending}>
              <RotateCw size={14} aria-hidden="true" /> Read again
            </button>
          </div>
        )}
        {!doc.active && <p className={styles.dNote}>Not in use: it is left out of answers, alerts and amendment chains. Amendments it makes stop applying.</p>}

        {ready(doc.ingest_status) && (
          <a className={styles.dPreview} href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" aria-label="Open the PDF">
            <img src={pageUrl(doc.id, 1, [], 96)} alt={`${doc.title}, first page`} loading="lazy" />
          </a>
        )}

        {related.length > 0 && (
          <section className={styles.dSection}>
            <h3>Amendments</h3>
            <ul className={styles.reviewList}>{related.map((a) => <AmendmentRow key={a.id} a={a} admin={admin} />)}</ul>
          </section>
        )}

        <section className={styles.dSection}>
          <h3>Clauses</h3>
          {detail.isLoading && <span className="skeleton" style={{ height: 80, display: 'block' }} />}
          <ol className={styles.clauses}>
            {detail.data?.clauses.map((c) => (
              <li key={c.id}>
                <span className={`${styles.cRef} tnum`}>{c.ref ?? '–'}</span>
                <span className={styles.cBody}>
                  {c.heading_path && <span className={styles.cHead}>{c.heading_path}</span>}
                  <span>{c.text.length > 220 ? `${c.text.slice(0, 219)}…` : c.text}</span>
                </span>
                <span className={`${styles.cPage} tnum`}>p.{c.page_start}{c.page_end !== c.page_start ? `–${c.page_end}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
