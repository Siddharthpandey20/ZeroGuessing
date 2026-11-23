import { createFileRoute } from "@tanstack/react-router";
import { InfoCard, PageShell } from "@/components/landing/PageShell";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features — Veridoc" },
      {
        name: "description",
        content:
          "Multi-document answers, exact citations, contradiction detection, amendment tracking and an AI that abstains without evidence.",
      },
      { property: "og:title", content: "Features — Veridoc" },
      {
        property: "og:description",
        content: "Everything Veridoc does to keep document answers verifiable.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FeaturesPage,
});

const features = [
  {
    label: "01 · Ask",
    title: "Multi-document answers",
    body: "Ask one question across policies, contracts and reports. Veridoc reads them together, not one at a time.",
  },
  {
    label: "02 · Cite",
    title: "Exact citations",
    body: "Every claim links to the document, page and passage it came from — highlighted, never paraphrased away.",
  },
  {
    label: "03 · Compare",
    title: "Contradiction detection",
    body: "When two sources disagree, you see both side by side, with which one currently applies.",
  },
  {
    label: "04 · Track",
    title: "Amendments & versions",
    body: "Answers follow the latest amendment, and show what changed and when.",
  },
  {
    label: "05 · Abstain",
    title: "Zero guessing",
    body: "No reliable evidence? Veridoc says so instead of inventing an answer.",
  },
  {
    label: "06 · Verify",
    title: "Faithfulness checks",
    body: "Each answer is checked against its sources before you see it, with a visible confidence signal.",
  },
];

function FeaturesPage() {
  return (
    <PageShell
      eyebrow="Features"
      title={
        <>
          Answers that <span className="italic text-gradient">show their work.</span>
        </>
      }
      intro="Veridoc is built around one rule: if it can't point to the evidence, it doesn't say it."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <InfoCard key={f.title} {...f} />
        ))}
      </div>
    </PageShell>
  );
}
