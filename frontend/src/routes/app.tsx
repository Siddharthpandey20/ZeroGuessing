import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/landing/PageShell";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Your workspace — Veridoc" },
      {
        name: "description",
        content: "The Veridoc workspace, where you upload documents and ask verified questions, is coming soon.",
      },
      { property: "og:title", content: "Your workspace — Veridoc" },
      { property: "og:description", content: "The Veridoc workspace is coming soon." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppPage,
});

function AppPage() {
  return (
    <PageShell
      eyebrow="Workspace"
      title={
        <>
          Your workspace is <span className="italic text-gradient">almost ready.</span>
        </>
      }
      intro="This is where you'll upload documents, ask questions and review cited evidence. Sign-in and the full workspace are coming next."
    >
      <div className="flex flex-wrap gap-3">
        <Link to="/how-it-works" className="btn-quiet px-5 py-2.5 text-sm">
          See how it works
        </Link>
        <Link to="/" className="btn-quiet px-5 py-2.5 text-sm">
          Back home
        </Link>
      </div>
    </PageShell>
  );
}
