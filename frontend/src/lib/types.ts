// Shapes returned by the FastAPI backend (backend/app/api/*, core/answer.py).

export type Verdict = 'supported' | 'unsupported' | 'contradicted' | 'conflicted'
export type ClauseState = 'current' | 'superseded' | 'not_yet_effective' | 'deleted' | string

export interface Citation {
  sentence_id: string
  doc_id: string
  doc_title: string
  clause_ref: string | null
  page: number
  quote: string
  bboxes: number[][]
  status: ClauseState
  status_note?: string | null
}

export interface Calculation {
  ok: boolean
  formula: string
  inputs: Record<string, unknown>
  steps: string[]
  result: number | null
  unit: string
  operand_citations?: string[]
  error?: string | null
  [k: string]: unknown
}

export interface Claim {
  text: string
  text_hi?: string | null
  verdict: Verdict
  reason: string | null
  citations: Citation[]
  kind: 'fact' | 'calc_result' | 'conflict_note'
  judge?: unknown
  calculation?: Calculation | null
  conflict_ids?: string[]
}

export interface ConflictSide {
  sentence_id: string
  doc_id: string
  doc_title: string
  clause_ref: string | null
  page: number
  quote: string
  bboxes: number[][]
  value: string
}

export interface Conflict {
  id: string
  subject: string
  attribute: string
  kind: 'number' | 'date' | 'rule' | 'eligibility'
  scope: string
  source: string
  explanation: string
  a: ConflictSide
  b: ConflictSide
  created_at: string
}

export interface ChainEvent {
  doc_title?: string
  clause_ref?: string | null
  sentence_id?: string
  page?: number | null
  text?: string
  quote?: string | null
  state?: string
  effective_date?: string | null
  action?: string
  new_text?: string | null
  [k: string]: unknown
}

export interface Chain {
  key: string
  state: string
  events: ChainEvent[]
}

export interface Faithfulness {
  supported: number
  total: number
  pct: number
  blocked: number
}

export interface Abstention {
  missing: string[]
  closest: Citation[]
  message: string
}

/** chat: a conversational reply (greeting, thanks, help) with no claims; shown as not from the documents. */
export type AnswerStatus = 'answered' | 'partial' | 'conflicted' | 'abstained' | 'chat'

export interface Answer {
  question: string
  question_en?: string | null
  lang: 'en' | 'hi'
  as_of: string
  status: AnswerStatus
  searched: { docs: number; terms: string[]; evidence: number }
  claims: Claim[]
  faithfulness: Faithfulness
  calculations: Calculation[]
  contradictions: Conflict[]
  amendment_chains: Chain[]
  abstention: Abstention | null
  /** Shown before the conflict check finished; an update with any conflicts follows in the same stream. */
  conflicts_pending?: boolean
  timings_ms: Record<string, number>
  /** every step the pipeline took, what it read and how long each took ("show work") */
  trace?: TraceStep[]
  cached?: boolean
  /** status chat: the reply text */
  reply?: string
  /** a follow-up, as it was understood from the earlier turns */
  question_resolved?: string | null
  /** answered with an overview built from the documents' own headings */
  overview?: boolean
  error?: string
}

export interface Message {
  id: string
  turn: number
  version: number
  question: string
  as_of: string
  input_mode: 'typed' | 'camera' | 'voice'
  status: 'pending' | 'done' | 'failed' | string
  answer: Answer | null
  created_at: string
}

export interface Turn {
  turn: number
  versions: Message[] // this turn's versions (siblings on the branch on screen), oldest first
  latest: number
  active?: number // the version on screen; the turns after it are the ones asked after that version
}

export interface ChatSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatDetail {
  id: string
  title: string
  turns: Turn[]
}

export interface DocumentRow {
  id: string
  title: string
  filename: string
  doc_type: string
  issuer: string | null
  circular_no: string | null
  issue_date: string | null
  source: string
  file_size: number
  page_count: number
  uploaded_at: string
  ingested_at: string | null
  ingest_status: string
  ingest_error: string | null
  active: boolean
  n_clauses: number
  n_amendments_proposed: number
  n_amendments_confirmed: number
  n_alerts: number
}

export interface ClauseRow {
  id: string
  ref: string | null
  heading_path: string | null
  page_start: number
  page_end: number
  text: string
}

export interface Amendment {
  id: string
  source_doc_id: string
  source_doc_title: string | null
  source_clause_ref: string | null
  source_sentence_id: string | null
  target_doc_id: string | null
  target_doc_title: string | null
  target_doc_ref: string | null
  target_clause_ref: string | null
  root_key: string | null
  via_amendment_id: string | null
  action: string
  new_text: string | null
  old_value: string | null
  new_value: string | null
  issue_date: string | null
  effective_date: string | null
  trigger_phrase: string | null
  confidence: number | null
  status: 'proposed' | 'confirmed' | 'rejected'
}

export interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
  role: 'admin' | 'viewer'
  active: boolean
  created_at: string
  last_login_at: string | null
}

export type Stage =
  | 'translating_question'
  | 'retrieving'
  | 'drafting'
  | 'verifying'
  | 'checking_contradictions'
  | 'translating_answer'

export interface StageEvent {
  type: 'stage'
  stage: Stage
  evidence?: number
  claims?: number
}

/** A document linked to one chat (GET /api/chats/{id}/documents). */
export interface ChatDoc {
  id: string
  title: string
  filename: string
  page_count: number
  file_size: number
  ingest_status: string
  ingest_error: string | null
  added_at: string
}

export interface UploadResult {
  filename: string
  document_id: string | null
  job_id: string | null
  status: 'queued' | 'duplicate' | 'rejected'
  detail: string | null
}

export interface TraceSource {
  doc_title: string
  clause_ref: string
  page: number
  sentence_id: string
  status: string
  added_for_amendment: boolean
}

export interface TraceCheck {
  text: string
  verdict: Verdict | string
  reason: string | null
  kind: string
  quotes: number
  judge: string | null
}

/** One step of the pipeline, as streamed (`trace` events) and kept on the answer. */
export interface TraceStep {
  id: 'understand' | 'translate_question' | 'search' | 'versions' | 'gate' | 'draft' | 'verify' | 'conflicts' | 'translate_answer' | string
  ms: number
  resolved?: string
  turns?: number
  english?: string | null
  docs?: number
  terms?: string[]
  passages?: number
  keyword_hits?: number
  best_score?: number | null
  threshold?: number
  sources?: TraceSource[]
  as_of?: string
  clauses?: { key: string; state: string; changes: number; pending: number; by: string | null; since: string | null }[]
  passed?: boolean
  claims?: number
  evidence?: number
  missing?: string[]
  checks?: TraceCheck[]
  pairs?: number
  relevant?: number
  kept?: number
  total?: number
}
