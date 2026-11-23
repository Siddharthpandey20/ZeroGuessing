import { createFileRoute } from "@tanstack/react-router";
import { InfoCard, PageShell } from "@/components/landing/PageShell";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Veridoc" },
      {
        name: "description",
        content: "Why we built Veridoc: document AI that earns trust with evidence, not confidence.",
      },
      { property: "og:title", content: "About — Veridoc" },
      {
        property: "og:description",
        content: "Document AI that earns trust with evidence, not confidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AboutPage,
});

const values = [
  {
    label: "Principle",
    title: "Evidence over eloquence",
    body: "A fluent answer is worthless if it's wrong. We optimise for answers you can check.",
  },
  {
    label: "Principle",
    title: "Silence over speculation",
    body: "Saying “I couldn't find this” is a feature, not a failure.",
  },
  {
    label: "Principle",
    title: "Documents change",
    body: "Policies get amended. Answers should always reflect the version that applies today.",
  },
];

function AboutPage() {
  return (
    <PageShell
      eyebrow="About"
      title={
        <>
          We built the AI we wanted to <span className="italic text-gradient">trust.</span>
        </>
      }
      intro="Teams rely on documents to make real decisions. Veridoc exists so that every answer drawn from them can be traced, checked and defended."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {values.map((v) => (
          <InfoCard key={v.title} {...v} />
        ))}
      </div>
    </PageShell>
  );
}
