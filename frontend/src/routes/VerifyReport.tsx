import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRightLeft, Check, ChevronDown, FileCheck2, FileUp, FileX2, LoaderCircle, ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react'
import { api, ApiError, post } from '../lib/api'
import { tr } from '../lib/i18n'
import { groupHex, sha256Hex, type ReportPayload, type VerifyResult } from '../lib/report'
import { LangSwitch } from '../components/LangSwitch'
import { fmtDate, fmtDateTime } from '../app/answer/selection'
import styles from './VerifyReport.module.css'

const STATUS = {
  genuine: { icon: ShieldCheck, head: 'Genuine and unchanged' },
  altered: { icon: ShieldAlert, head: 'Altered after it was issued' },
  foreign: { icon: ShieldAlert, head: 'Not issued by this system' },
  unsigned: { icon: ShieldQuestion, head: 'No signature in this file' },
} as const

/**
 * Public page: is this report genuine? By ID (the register's copy is shown, to compare with yours) or by dropping the
 * offline HTML copy (its signature is checked). Source PDFs can be matched against the report's fingerprints on this
 * device, without uploading them.
 */
export default function VerifyReport() {
  const { id: routeId } = useParams()
  const nav = useNavigate()
  const [id, setId] = useState(routeId ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<(VerifyResult & { via: 'id' | 'file' }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const byId = async (raw: string) => {
    const rid = raw.trim()
    if (!rid) return
    setBusy(true); setError(null); setResult(null)
    try {
      setResult({ ...(await api<VerifyResult>(`/public/reports/${encodeURIComponent(rid)}`)), via: 'id' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setResult({ status: 'foreign', id: rid, detail: tr('No report with this ID was issued here.'), via: 'id' })
      else setError(tr('The check could not be run. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const byFile = async (f: File) => {
    setBusy(true); setError(null); setResult(null)
    try {
      const text = await f.text()
      const body = f.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : { html: text }
      const r = await post<VerifyResult>('/public/reports/verify', body)
      setResult({ ...r, via: 'file' })
      if (r.id) setId(r.id)
    } catch {
      setError(tr('This file could not be read as a report.'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (routeId) void byId(routeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link to="/" className={`${styles.brand} wordmark`}>zeroguess</Link>
        <LangSwitch />
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={`${styles.kicker} readout`}>{tr('Report verification')}</p>
          <h1 className={styles.h1}>{tr('Is this report genuine?')}</h1>
          <p className={styles.lead}>{tr('Enter the report ID printed on it, or drop the offline copy you were sent. The answer comes from the report’s digital signature, which nobody can reproduce without the issuing server’s private key.')}</p>
        </div>

        <form className={styles.ask} onSubmit={(e) => { e.preventDefault(); nav(`/verify/${encodeURIComponent(id.trim())}`); void byId(id) }}>
          <label className="sr-only" htmlFor="rid">{tr('Report ID')}</label>
          <input id="rid" className={`input ${styles.idInput}`} value={id} onChange={(e) => setId(e.target.value)} placeholder="ZG-XXXX-XXXX" autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn btn-ink" disabled={busy || !id.trim()}>{busy ? <LoaderCircle size={15} className={styles.spin} aria-hidden="true" /> : null}{tr('Verify')}</button>
          <span className={styles.or}>{tr('or')}</span>
          <input ref={file} type="file" accept=".html,.htm,.json,text/html,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void byFile(f); e.target.value = '' }} />
          <button type="button" className={`btn btn-ghost ${styles.drop}`} onClick={() => file.current?.click()} disabled={busy}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void byFile(f) }}>
            <FileUp size={15} strokeWidth={1.8} aria-hidden="true" /> {tr('Check an offline copy')}
          </button>
        </form>

        {error && <p className={styles.error} role="alert">{error}</p>}
        {result && <Result r={result} />}
      </main>
    </div>
  )
}

function Result({ r }: { r: VerifyResult & { via: 'id' | 'file' } }) {
  const s = STATUS[r.status]
  const Icon = s.icon
  const p = r.payload
  const body =
    r.status === 'genuine'
      ? r.via === 'file'
        ? tr('The signature matches and the report is in the register. Every question, answer, quote and document fingerprint is exactly as issued.')
        : tr('This is the report exactly as issued. If the copy you were sent says anything different, it was changed.')
      : r.status === 'altered'
        ? tr('The contents no longer match the signature: something was changed after it was issued. What was actually issued is shown below; compare it with your copy.')
        : r.status === 'foreign'
          ? tr('This report was not issued by this system, or its ID was typed wrong.')
          : tr('No signed report was found in this file. Only offline copies downloaded from a share link carry a signature.')
  return (
    <section className={styles.result} aria-live="polite">
      <div className={styles.status} data-status={r.status}>
        <Icon size={26} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <p className={styles.statusHead}>{tr(s.head)}</p>
          <p className={styles.statusBody}>{body}</p>
          {r.link && r.link !== 'active' && (
            <p className={styles.linkNote}>{tr(r.link === 'revoked' ? 'Its share link was withdrawn by the sender. The report itself remains genuine.' : 'Its share link has expired. The report itself remains genuine.')}</p>
          )}
        </div>
      </div>
      {p && <Details p={p} fingerprint={r.fingerprint} />}
    </section>
  )
}

function Details({ p, fingerprint }: { p: ReportPayload; fingerprint?: string }) {
  const [own, setOwn] = useState(false)
  return (
    <>
      <dl className={styles.meta}>
        <div><dt>{tr('Report ID')}</dt><dd className="tnum">{p.id}</dd></div>
        <div><dt>{tr('Issued by')}</dt><dd>{p.issued_by.name}{p.issued_by.domain ? <span className={styles.domain}> · {p.issued_by.domain}</span> : null}</dd></div>
        <div><dt>{tr('Issued on')}</dt><dd>{fmtDateTime(p.issued_at)}</dd></div>
        {fingerprint && <div className={styles.wide}><dt>{tr('Fingerprint')}</dt><dd><code className={styles.hex}>{groupHex(fingerprint)}</code></dd></div>}
      </dl>

      {p.documents.length > 0 && <Documents docs={p.documents} />}

      <section className={styles.block} aria-labelledby="issued-h">
        <h2 id="issued-h" className={styles.h2}>{tr('What was issued')}</h2>
        <p className={styles.blockNote}>{p.title}</p>
        <ol className={styles.turns}>
          {p.turns.map((t) => (
            <li key={t.turn} className={styles.turn}>
              <p className={styles.q}>{t.question}</p>
              <p className={styles.asof}>{tr('Rule in force on')} {fmtDate(t.as_of)}{t.faithfulness ? ` · ${Math.round(t.faithfulness.pct)}% ${tr('faithful')}` : ''}</p>
              {t.reply && <p className={styles.claimText}>{t.reply}</p>}
              <ul className={styles.claims}>
                {t.claims.map((c, i) => {
                  const shown = c.verdict === 'supported' || c.verdict === 'conflicted'
                  return (
                    <li key={i} data-verdict={c.verdict}>
                      <span className={styles.mark} aria-hidden="true">
                        {c.verdict === 'supported' ? <Check size={11} strokeWidth={3} /> : c.verdict === 'conflicted' ? <ArrowRightLeft size={11} strokeWidth={2.4} /> : <X size={11} strokeWidth={3} />}
                      </span>
                      <div>
                        <p className={styles.claimText} data-blocked={!shown || undefined}>{c.text}</p>
                        {c.citations.map((x, k) => (
                          <p key={k} className={styles.cite}><span>{x.doc_title}{x.clause_ref && !x.clause_ref.startsWith('_') ? `, ${x.clause_ref}` : ''}, p.{x.page}</span> “{x.quote}”</p>
                        ))}
                        {!shown && c.reason && <p className={styles.reason}>{c.reason}</p>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {t.abstention && <p className={styles.abst}>{t.abstention}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.block}>
        <button type="button" className={styles.disclose} aria-expanded={own} onClick={() => setOwn((v) => !v)}>
          {tr('Verify it yourself, without trusting this page')} <ChevronDown size={14} aria-hidden="true" />
        </button>
        {own && (
          <div className={styles.own}>
            <p>{tr('Reports are signed with Ed25519 over the JSON of the report (sorted keys, no spaces). The public key is at')} <a href="/public/reports/key" target="_blank" rel="noreferrer">/public/reports/key</a> ({tr('key ID')} <code>{p.key_id}</code>).</p>
            <pre className={styles.code}>{`import base64, json, urllib.request
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
key = json.load(urllib.request.urlopen(ORIGIN + "/public/reports/key"))
r = json.load(urllib.request.urlopen(ORIGIN + "/public/reports/${p.id}"))
data = json.dumps(r["payload"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
Ed25519PublicKey.from_public_bytes(base64.b64decode(key["public_key"])).verify(base64.b64decode(r["signature"]), data)
print("genuine")  # verify() raises InvalidSignature otherwise`}</pre>
          </div>
        )}
      </section>
    </>
  )
}

/** The source PDFs by fingerprint, and a drop zone that hashes a PDF on this device to see if it is the same version. */
function Documents({ docs }: { docs: ReportPayload['documents'] }) {
  const [check, setCheck] = useState<{ name: string; match: string | null } | 'busy' | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const run = async (f: File) => {
    setCheck('busy')
    const h = await sha256Hex(f)
    setCheck({ name: f.name, match: docs.find((d) => d.sha256 === h)?.sha256 ?? null })
  }
  const matched = check && check !== 'busy' ? check.match : null
  return (
    <section className={styles.block} aria-labelledby="docs-h">
      <h2 id="docs-h" className={styles.h2}>{tr('Source documents')}</h2>
      <p className={styles.blockNote}>{tr('The answers were based on these exact files. A changed PDF, even by one character, has a different fingerprint.')}</p>
      <ul className={styles.docs}>
        {docs.map((d) => (
          <li key={d.sha256} data-match={matched === d.sha256 || undefined}>
            <span className={styles.docTitle}>{d.title}</span>
            <span className={styles.docMeta}>{tr(d.pages === 1 ? '{n} page' : '{n} pages', { n: d.pages })}</span>
            <code className={styles.hexSmall} title={d.sha256}>{groupHex(d.sha256.slice(0, 16))} …</code>
            {matched === d.sha256 && <span className={styles.matchTag}><Check size={12} strokeWidth={3} aria-hidden="true" /> {tr('same version')}</span>}
          </li>
        ))}
      </ul>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = '' }} />
      <button type="button" className={styles.pdfDrop} onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void run(f) }}>
        <FileUp size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{tr('Check a PDF against this report')}</span>
        <span className={styles.pdfNote}>{tr('Nothing is uploaded: the file is fingerprinted on this device.')}</span>
      </button>
      {check === 'busy' && <p className={styles.checkLine}><LoaderCircle size={14} className={styles.spin} aria-hidden="true" /> {tr('Fingerprinting')}</p>}
      {check && check !== 'busy' && (
        <p className={styles.checkLine} data-ok={!!check.match || undefined} role="status">
          {check.match ? <FileCheck2 size={15} aria-hidden="true" /> : <FileX2 size={15} aria-hidden="true" />}
          {check.match
            ? tr('{file} is the exact version this report was based on.', { file: check.name })
            : tr('{file} is not one of this report’s documents, or it is a different version of one.', { file: check.name })}
        </p>
      )}
    </section>
  )
}
