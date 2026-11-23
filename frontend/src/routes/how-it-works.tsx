import { createFileRoute } from "@tanstack/react-router";
import { InfoCard, PageShell } from "@/components/landing/PageShell";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How It Works — Veridoc" },
      {
        name: "description",
        content: "From upload to verified answer: how Veridoc reads, cites and checks your documents.",
      },
      { property: "og:title", content: "How It Works — Veridoc" },
      {
        property: "og:description",
        content: "Upload, ask, see the evidence, trust the answer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HowItWorksPage,
});

const steps = [
  {
    label: "Step 1",
    title: "Add your documents",
    body: "Drop in policies, handbooks, contracts and their amendments. Versions are linked automatically.",
  },
  {
    label: "Step 2",
    title: "Ask in plain language",
    body: "Ask the way you would ask a colleague. Veridoc searches every document in scope.",
  },
  {
    label: "Step 3",
    title: "See the evidence",
    body: "The answer arrives with the exact quote, document name and page — and any conflicting sources.",
  },
  {
    label: "Step 4",
    title: "Verified, or honestly unsure",
    body: "Answers are checked against the source. If the evidence isn't there, Veridoc tells you.",
  },
];

function HowItWorksPage() {
  return (
    <PageShell
      eyebrow="How it works"
      title={
        <>
          From question to <span className="italic text-gradient">proof</span> in seconds.
        </>
      }
      intro="Four steps, and every answer stays traceable back to the page it came from."
    >
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <InfoCard key={s.title} {...s} />
        ))}
      </div>
    </PageShell>
  );
}
