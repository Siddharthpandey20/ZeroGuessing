# Demo corpus: planted facts

All organisations are fictional. Built by `uv run python -m scripts.build_corpus`. Gold questions are in `eval/gold.jsonl`.

## Documents
| ID | File | Notes |
|---|---|---|
| A | A_master_policy_retail_loans.pdf | Master Policy v1, Circular SCB/RL/2025/01, 1 Apr 2025, 3 pages; Schedule I table spans pp. 2–3 |
| B | B_circular_2025_14_prepayment.pdf | Amends A 7.2 (2% → 1%) w.e.f. 1 Nov 2025; inserts 7.2A |
| C | C_circular_2026_03_relief.pdf | ¶3 amends **B ¶2** → Nil for individuals w.e.f. 1 Jul 2026 (3-level chain); ¶5 amends A 6.3 fee cap ₹25,000 → ₹20,000 w.e.f. **1 Jan 2027** (future-dated); ¶6 deletes A 8.5 w.e.f. 1 Jul 2026 |
| D | D_key_facts_statement_home_loan.pdf | ₹30,00,000, 9.50% p.a., 240 months (EMI ≈ ₹27,965); penal 24% p.a. |
| E | E_vendor_services_agreement.pdf | Pays invoices within 45 days; fee ₹4,00,000/month; SLA service-credit table |
| F | F_insurance_policy_wording.pdf | Grace period 30 days (4.3); co-borrowers covered (3.2) |
| G | G_insurance_policy_schedule.pdf | Grace period 15 days (2.2); primary borrower only, co-borrowers not covered (1.1) |

## Intended contradictions (5)
1. Penal charges: A 8.1 "2% p.a. over the contracted rate" vs D 2.2 "24% p.a." (cross-document, number)
2. Vendor payment: A 11.2 "within 30 days" vs E 4.2 "within 45 days" (cross-document, number)
3. Grace period: F 4.3 "30 days" vs G 2.2 "15 days" (cross-document, number)
4. Co-borrower cover: F 3.2 "covered" vs G 1.1 "not covered" (cross-document, eligibility, no numbers)
5. Complaint resolution: A 9.1 "30 days" vs A Annex 3 "21 days" (intra-document)

## Not contradictions (must not be flagged)
- A 7.2 vs B ¶2 vs C ¶3: an amendment chain (supersession)
- A 7.2 (floating, 2%) vs A 7.3 (fixed, 3%): different conditions
- A 6.3 fee cap vs D 2.1 ₹25,000 fee: consistent (1% of ₹30 lakh is ₹30,000, capped at ₹25,000)

## Gaps (unanswerable)
Gold loans, NRI borrowers, top-up loan interest rate, cryptocurrency, the pre-existing-condition waiting period (F 6.2 points to the Schedule, and the Schedule doesn't state it), and the NOC fee after 1 Jul 2026 (deleted).

## Known parser limitation shown by this corpus
One Schedule I row ("Annual maintenance of escrow account") is split across a page break by the PDF generator. It is kept as plain text: still searchable and citable, but not as a structured table row.
