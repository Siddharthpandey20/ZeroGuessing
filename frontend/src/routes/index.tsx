import { createFileRoute } from "@tanstack/react-router";
import { HeroSection } from "@/components/landing/HeroSection";
import { ProofSection } from "@/components/landing/ProofSection";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Veridoc: answers from your documents, with proof" },
      {
        name: "description",
        content:
          "Ask across loan agreements, policies and circulars. Every answer quotes the exact clause and page, conflicts are shown side by side, and it says when it has no proof.",
      },
      { property: "og:title", content: "Veridoc: answers from your documents, with proof" },
      {
        property: "og:description",
        content:
          "Evidence-based answers across all your documents, with exact page citations and contradiction alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main>
      <HeroSection />
      <ProofSection />
      <SiteFooter />
    </main>
  );
}
