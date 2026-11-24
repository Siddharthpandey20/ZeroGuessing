/** Tamper-proof reports: the signed record behind every shared chat (see backend app/core/reports.py). */

export interface ReportCitation { doc_title: string | null; doc_sha256: string | null; clause_ref: string | null; page: number | null; quote: string | null }
export interface ReportClaim { text: string; verdict: string; reason: string | null; citations: ReportCitation[] }
export interface ReportTurn {
  turn: number
  question: string
  as_of: string
  status: string | null
  reply: string | null
  claims: ReportClaim[]
  faithfulness: { supported: number; total: number; pct: number; blocked: number } | null
  abstention: string | null
  conflicts: { subject: string | null; a: { doc_title: string; page: number; quote: string }; b: { doc_title: string; page: number; quote: string } }[]
}
export interface ReportPayload {
  v: number
  id: string
  alg: string
  key_id: string
  issued_at: string
  issued_by: { name: string; domain: string | null }
  title: string
  turns: ReportTurn[]
  documents: { title: string; filename: string; sha256: string; pages: number }[]
}

/** genuine: signed here and unchanged. altered: claims to be from here but the content changed. foreign: another key.
 *  unsigned: no signed block in the file. */
export type ReportStatus = 'genuine' | 'altered' | 'foreign' | 'unsigned'

export interface VerifyResult {
  status: ReportStatus
  id?: string
  detail?: string
  fingerprint?: string
  link?: 'active' | 'revoked' | 'expired' | 'removed' | null
  payload?: ReportPayload
  /** the share link is no longer live: the register says genuine or altered, but shows none of the contents */
  withheld?: boolean
  withheld_reason?: string
}

export interface ReportBlock { id: string; fingerprint: string; signature: string; payload: ReportPayload }

/** SHA-256 of a file, on this device (nothing is uploaded). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 64 hex chars in groups of four, for reading aloud or comparing by eye. */
export const groupHex = (h: string) => h.match(/.{1,4}/g)?.join(' ') ?? h
