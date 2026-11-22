"""Build the synthetic demo corpus (plan Q10) -> corpus/pdf/*.pdf. Fictional organisations only.
Run: uv run python -m scripts.build_corpus"""

from pathlib import Path

from app.ingest.htmlpdf import html_to_pdf

OUT = Path(__file__).resolve().parents[1] / "corpus" / "pdf"
BANK = "Sunrise Co-operative Bank Ltd. (fictional)"
INS = "Suraksha General Insurance Co. Ltd. (fictional)"

SCHEDULE_ROWS = [
    ("Cheque / ECS / NACH bounce", "All retail loans", "₹500 per instance"),
    ("Duplicate repayment schedule", "All retail loans", "₹250 per copy"),
    ("Duplicate no-dues certificate", "All retail loans", "₹300 per copy"),
    ("Statement of account (additional)", "All retail loans", "₹200 per statement"),
    ("CERSAI registration", "Home loan", "₹100 per property"),
    ("Legal and valuation charges", "Home loan", "At actuals, maximum ₹10,000"),
    ("Change of repayment mode", "All retail loans", "₹500 per request"),
    ("Swap of post-dated cheques", "All retail loans", "₹500 per request"),
    ("Conversion from fixed to floating rate", "Home loan", "0.5% of outstanding principal"),
    ("Conversion from floating to fixed rate", "Home loan", "1% of outstanding principal"),
    ("Document retrieval (photocopy)", "All retail loans", "₹500 per set"),
    ("Recovery charges", "All retail loans", "At actuals"),
    ("Stamp duty", "All retail loans", "As per State law"),
    ("Issue of interest certificate (additional)", "Home loan", "₹100 per certificate"),
    ("Part-disbursement re-inspection", "Home loan", "₹1,500 per visit"),
    ("Loan cancellation after sanction", "All retail loans", "₹2,000"),
    ("Late submission of insurance renewal", "Home loan", "₹250 per month of delay"),
    ("Penal charge for non-submission of property documents", "Home loan", "₹1,000 per month"),
    ("Top-up loan documentation", "Home loan", "₹2,500"),
    ("Tenure change request", "All retail loans", "₹1,000 per request"),
    ("Address change in loan records", "All retail loans", "Nil"),
    ("Foreclosure statement (second and later)", "All retail loans", "₹200 per statement"),
    ("Visit charges for overdue collection", "All retail loans", "₹350 per visit"),
    ("Original documents retrieval after closure (after 30 days)", "Home loan", "Nil; compensation as per clause 10.2"),
    ("Valuation report copy", "Home loan", "₹300"),
    ("Duplicate sanction letter", "All retail loans", "₹250"),
    ("NACH mandate re-registration", "All retail loans", "₹300"),
    ("Physical statement by courier", "All retail loans", "₹100 per dispatch"),
    ("Annual maintenance of escrow account", "Home loan (builder-linked)", "₹1,200 per year"),
    ("Penal interest certificate", "All retail loans", "₹150"),
    ("Life-cycle document vault (optional)", "Home loan", "₹600 per year"),
    ("Mortgage modification deed", "Home loan", "At actuals, maximum ₹5,000"),
]

MASTER = f"""
<h1>Master Policy on Retail Loans</h1>
<p class="meta">{BANK} — Circular No. SCB/RL/2025/01 dated 1 April 2025 — Version 1.0</p>
<h2>1. Introduction</h2>
<p>1.1 This Master Policy sets out the terms governing retail loans sanctioned by the Bank, including home loans, loans against property and personal loans.</p>
<p>1.2 This Policy comes into force on 1 April 2025 and applies to all loans sanctioned on or after that date.</p>
<h2>5. Eligibility and Margin</h2>
<p>5.1 Applicants must be at least 21 years of age at the time of application and not more than 70 years of age at loan maturity.</p>
<p>5.4 The maximum loan-to-value ratio for home loans shall be 80% of the market value of the property.</p>
<p>5.5 Co-borrowers must be close relatives of the primary borrower and must be named in the loan agreement.</p>
<h2>6. Interest and Fees</h2>
<p>6.1 Home loans shall be offered on a floating rate linked to the Bank's External Benchmark Lending Rate, reset every three months.</p>
<p>6.3 The processing fee for home loans shall be 1% of the loan amount, subject to a minimum of ₹5,000 and a maximum of ₹25,000.</p>
<p>6.4 Other charges are listed in Schedule I. No charge not listed in Schedule I shall be levied.</p>
<h2>7. Prepayment and Foreclosure</h2>
<p>7.1 Borrowers may prepay the loan in full or in part at any time after the first disbursement.</p>
<p>7.2 The prepayment penalty on floating-rate home loans shall be 2% (two per cent) of the outstanding principal.</p>
<p>7.3 The prepayment penalty on fixed-rate home loans shall be 3% (three per cent) of the amount prepaid.</p>
<p>7.4 No prepayment penalty shall be levied where the prepayment is made from the borrower's own sources and the borrower is an individual.</p>
<h2>8. Penal Charges</h2>
<p>8.1 Penal charges on an overdue instalment shall be 2% p.a. over the contracted rate, calculated on the overdue amount for the number of days it remains unpaid.</p>
<p>8.2 Penal charges shall not be capitalised and no further interest shall be computed on such charges.</p>
<p>8.5 A fee of ₹1,000 shall be levied for the issue of a no-objection certificate on closure of the loan.</p>
<h2>9. Grievance Redressal</h2>
<p>9.1 Every complaint shall be acknowledged within 2 working days and resolved within 30 days of receipt.</p>
<p>9.2 If the complaint is not resolved, the borrower may approach the Banking Ombudsman.</p>
<h2>10. Return of Documents</h2>
<p>10.1 Original property documents shall be returned within 30 days of full repayment and closure of the loan account.</p>
<p>10.2 For any delay beyond 30 days attributable to the Bank, compensation of ₹5,000 per day of delay shall be paid to the borrower.</p>
<h2>11. Outsourcing</h2>
<p>11.1 The Bank may outsource loan servicing activities to service providers approved by the Board.</p>
<p>11.2 Undisputed invoices of service providers shall be paid within 30 days of receipt of the invoice.</p>
<h2>Schedule I: Schedule of Charges</h2>
<table><thead><tr><th>Charge</th><th>Applicable to</th><th>Amount</th></tr></thead><tbody>
{''.join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>' for a, b, c in SCHEDULE_ROWS)}
</tbody></table>
<h2>Annex 3: Customer Service Standards</h2>
<p>All complaints received through any channel shall be registered in the complaint management system.</p>
<p>Complaints shall be resolved within 21 days of receipt, failing which they shall be escalated to the Principal Nodal Officer.</p>
"""

CIRC_B = f"""
<h1>Circular: Revision of Prepayment Charges on Home Loans</h1>
<p class="meta">{BANK} — Circular No. SCB/RL/2025/14 dated 1 October 2025</p>
<p>To: All Branches and Retail Loan Centres</p>
<p>1. The Board of Directors has reviewed the prepayment charges on floating-rate home loans in its meeting held on 20 September 2025.</p>
<p>2. In partial modification of paragraph 7.2 of the Master Policy on Retail Loans (Circular No. SCB/RL/2025/01 dated 1 April 2025), paragraph 7.2 shall be substituted with effect from 1 November 2025 to read: “7.2 The prepayment penalty on floating-rate home loans shall be 1% (one per cent) of the outstanding principal.”</p>
<p>3. After paragraph 7.2 of the Master Policy, the following paragraph shall be inserted with effect from 1 November 2025: “7.2A No prepayment penalty shall be levied on part-prepayments not exceeding 25% of the outstanding principal in a financial year.”</p>
<p>4. All other terms of the Master Policy remain unchanged.</p>
<p>Chief General Manager, Retail Lending</p>
"""

CIRC_C = f"""
<h1>Circular: Prepayment Relief and Revision of Processing Fee</h1>
<p class="meta">{BANK} — Circular No. SCB/RL/2026/03 dated 15 June 2026</p>
<p>To: All Branches and Retail Loan Centres</p>
<p>1. Please refer to Circular No. SCB/RL/2025/14 dated 1 October 2025 on prepayment charges.</p>
<p>3. Paragraph 2 of Circular No. SCB/RL/2025/14 stands substituted with effect from 1 July 2026 to read: “The prepayment penalty on floating-rate home loans for individual borrowers shall be Nil.”</p>
<p>5. Paragraph 6.3 of the Master Policy on Retail Loans shall be substituted with effect from 1 January 2027 to read: “6.3 The processing fee for home loans shall be 1% of the loan amount, subject to a minimum of ₹5,000 and a maximum of ₹20,000.”</p>
<p>6. Paragraph 8.5 of the Master Policy on Retail Loans stands deleted with effect from 1 July 2026.</p>
<p>7. All other terms remain unchanged.</p>
<p>Chief General Manager, Retail Lending</p>
"""

KFS = f"""
<h1>Key Facts Statement – Home Loan</h1>
<p class="meta">{BANK} — Statement dated 5 May 2026 — Loan Account No. HL-2026-00417</p>
<h2>1. Loan Details</h2>
<p>1.1 Loan amount sanctioned: ₹30,00,000 (Rupees thirty lakh).</p>
<p>1.2 Rate of interest: 9.50% p.a., floating, linked to the External Benchmark Lending Rate.</p>
<p>1.3 Loan tenure: 240 months.</p>
<p>1.4 Repayment by equated monthly instalments on the 5th of every month.</p>
<h2>2. Fees and Charges</h2>
<p>2.1 Processing fee: ₹25,000, payable at sanction.</p>
<p>2.2 Penal charges: 24% p.a. on the overdue amount for the period of default.</p>
<p>2.3 Prepayment: as per the Bank's policy in force on the date of prepayment.</p>
<h2>3. Grievance Redressal</h2>
<p>3.1 Complaints may be sent to the Grievance Redressal Officer at grievance@sunrise-coop.example.</p>
"""

VENDOR = f"""
<h1>Loan Servicing Platform Services Agreement</h1>
<p class="meta">Between {BANK} (the Bank) and Kavach Tech Solutions Pvt. Ltd. (fictional) (the Service Provider) — dated 1 June 2025</p>
<h2>1. Scope</h2>
<p>1.1 The Service Provider shall host, operate and maintain the Bank's loan servicing platform.</p>
<h2>4. Fees and Payment</h2>
<p>4.1 The Bank shall pay a monthly service fee of ₹4,00,000 (Rupees four lakh) exclusive of taxes.</p>
<p>4.2 The Bank shall pay undisputed invoices within 45 days of receipt of the invoice.</p>
<p>4.3 Disputed amounts shall be notified in writing within 10 days of receipt of the invoice.</p>
<h2>5. Service Levels</h2>
<p>5.1 The platform shall be available at least 99.9% of the time in each calendar month, excluding scheduled maintenance.</p>
<p>5.2 If availability falls below the levels in the table below, the Service Provider shall credit the stated percentage of the monthly service fee.</p>
<table><thead><tr><th>Monthly availability</th><th>Service credit</th></tr></thead><tbody>
<tr><td>99.5% to below 99.9%</td><td>5% of the monthly service fee</td></tr>
<tr><td>99.0% to below 99.5%</td><td>10% of the monthly service fee</td></tr>
<tr><td>Below 99.0%</td><td>20% of the monthly service fee</td></tr>
</tbody></table>
<h2>9. Term and Termination</h2>
<p>9.1 This Agreement is valid for 36 months from 1 June 2025.</p>
<p>9.2 Either party may terminate this Agreement by giving 90 days' written notice.</p>
"""

WORDING = f"""
<h1>Home Loan Protection Insurance – Policy Wording</h1>
<p class="meta">{INS} — Group policy for borrowers of {BANK} — Wording version 2.1 dated 1 March 2025</p>
<h2>3. Who is Covered</h2>
<p>3.1 The primary borrower of a home loan sanctioned by the Bank is covered from the date of first disbursement.</p>
<p>3.2 Co-borrowers named in the loan agreement are covered for their share of the outstanding loan.</p>
<h2>4. Premium</h2>
<p>4.1 The premium is payable annually in advance.</p>
<p>4.3 A grace period of 30 days from the premium due date is allowed, during which cover continues.</p>
<h2>5. Benefits</h2>
<p>5.1 On the death of an insured person, the Insurer shall pay the Bank the insured person's share of the outstanding loan on the date of death.</p>
<h2>6. Exclusions</h2>
<p>6.1 Death by suicide within 12 months from the date of commencement of cover is excluded.</p>
<p>6.2 Pre-existing conditions are subject to a waiting period as specified in the Policy Schedule.</p>
<h2>7. Claims</h2>
<p>7.1 Claims shall be intimated within 90 days of the date of death.</p>
<table><thead><tr><th>Document</th><th>Required for</th></tr></thead><tbody>
<tr><td>Death certificate</td><td>All claims</td></tr><tr><td>Loan account statement</td><td>All claims</td></tr>
<tr><td>Post-mortem report</td><td>Accidental death</td></tr><tr><td>Medical records</td><td>Death within 24 months of cover</td></tr>
</tbody></table>
"""

SCHEDULE = f"""
<h1>Policy Schedule – Home Loan Protection Insurance</h1>
<p class="meta">{INS} — Master Policy No. SGI/HLP/2025/118 — Schedule dated 1 March 2025</p>
<h2>1. Cover</h2>
<p>1.1 Insured: primary borrower only; co-borrowers are not covered.</p>
<p>1.2 Sum insured: the outstanding home loan principal, reducing monthly.</p>
<h2>2. Premium</h2>
<p>2.1 Annual premium: 0.35% of the outstanding principal.</p>
<p>2.2 Grace period: 15 days from the premium due date.</p>
"""

DOCS = {
    "A_master_policy_retail_loans.pdf": (MASTER, f"{BANK} · Master Policy on Retail Loans"),
    "B_circular_2025_14_prepayment.pdf": (CIRC_B, f"{BANK} · Circular SCB/RL/2025/14"),
    "C_circular_2026_03_relief.pdf": (CIRC_C, f"{BANK} · Circular SCB/RL/2026/03"),
    "D_key_facts_statement_home_loan.pdf": (KFS, f"{BANK} · Key Facts Statement"),
    "E_vendor_services_agreement.pdf": (VENDOR, "Loan Servicing Platform Services Agreement"),
    "F_insurance_policy_wording.pdf": (WORDING, f"{INS} · Policy Wording"),
    "G_insurance_policy_schedule.pdf": (SCHEDULE, f"{INS} · Policy Schedule"),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (html, footer) in DOCS.items():
        (OUT / name).write_bytes(html_to_pdf(html, footer=footer))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
