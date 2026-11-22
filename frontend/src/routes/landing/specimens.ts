// Specimens on the landing page are taken from the demo corpus (backend/corpus/FACTS.md),
// and the crops are rendered from those PDFs. No figure here is invented.
import a72 from '../../assets/specimens/a72.webp'
import a81 from '../../assets/specimens/a81.webp'
import b2 from '../../assets/specimens/b2.webp'
import c3 from '../../assets/specimens/c3.webp'
import d22 from '../../assets/specimens/d22.webp'
import f32 from '../../assets/specimens/f32.webp'
import g11 from '../../assets/specimens/g11.webp'
import type { ChipSource } from '../../components/CitationChip'

export const SRC = {
  c3: {
    docTitle: 'Circular SCB/RL/2026/03',
    clause: '¶3',
    page: 1,
    quote: 'The prepayment penalty on floating-rate home loans for individual borrowers shall be Nil.',
    img: c3,
  },
  b2: {
    docTitle: 'Circular SCB/RL/2025/14',
    clause: '¶2',
    page: 1,
    quote: '7.2 The prepayment penalty on floating-rate home loans shall be 1% (one per cent) of the outstanding principal.',
    img: b2,
  },
  a72: {
    docTitle: 'Master Policy on Retail Loans',
    clause: '7.2',
    page: 1,
    quote: '7.2 The prepayment penalty on floating-rate home loans shall be 2% (two per cent) of the outstanding principal.',
    img: a72,
    status: 'superseded',
    statusNote: 'Superseded: substituted by Circular 2025/14, then by Circular 2026/03 from 1 July 2026.',
  },
  a81: {
    docTitle: 'Master Policy on Retail Loans',
    clause: '8.1',
    page: 1,
    quote: '8.1 Penal charges on an overdue instalment shall be 2% p.a. over the contracted rate, calculated on the overdue amount for the number of days it remains unpaid.',
    img: a81,
  },
  d22: {
    docTitle: 'Key Facts Statement, Home Loan',
    clause: '2.2',
    page: 1,
    quote: '2.2 Penal charges: 24% p.a. on the overdue amount for the period of default.',
    img: d22,
  },
  f32: {
    docTitle: 'Home Loan Protection, Policy Wording',
    clause: '3.2',
    page: 1,
    quote: '3.2 Co-borrowers named in the loan agreement are covered for their share of the outstanding loan.',
    img: f32,
  },
  g11: {
    docTitle: 'Home Loan Protection, Policy Schedule',
    clause: '1.1',
    page: 1,
    quote: '1.1 Insured: primary borrower only; co-borrowers are not covered.',
    img: g11,
  },
} satisfies Record<string, ChipSource>

/** The amendment chain for clause 7.2, as the resolver walks it. */
export const CHAIN = [
  { date: '2025-04-01', label: '1 Apr 2025', value: '2%', of: 'of the outstanding principal', source: SRC.a72, doc: 'Master Policy 7.2', note: 'Original rule' },
  { date: '2025-11-01', label: '1 Nov 2025', value: '1%', of: 'of the outstanding principal', source: SRC.b2, doc: 'Circular 2025/14 ¶2', note: 'Substitutes 7.2' },
  { date: '2026-07-01', label: '1 Jul 2026', value: 'Nil', of: 'for individual borrowers', source: SRC.c3, doc: 'Circular 2026/03 ¶3', note: 'Substitutes ¶2 of 2025/14' },
] as const
