import { Link } from "@tanstack/react-router";
import { BRAND_NAME } from "@/lib/brand";
import { BrandMark } from "./BrandMark";

export function SiteFooter() {
  return (
    <footer className="bg-paper">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-ink py-14 md:flex-row md:items-end">
          <div className="max-w-[32rem]">
            <p className="font-display text-[clamp(1.6rem,2.6vw,2.2rem)] font-semibold leading-tight text-foreground">
              Bring your own PDFs, or start with the samples.
            </p>
            <p className="mt-2 text-muted-foreground">
              Upload loan agreements, policy terms or circulars and ask your first question.
            </p>
          </div>
          <Link to="/app" className="btn-ink px-5 py-3 text-[15px]">
            Open the workspace
          </Link>
        </div>

        <div className="flex flex-col gap-4 border-t border-rule py-8 text-[0.875rem] text-muted-foreground md:flex-row md:items-center md:justify-between">
          <Link to="/" className="flex items-center gap-2 text-foreground">
            <BrandMark className="h-5 w-5" />
            <span className="font-medium">{BRAND_NAME}</span>
          </Link>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/features" className="hover:text-foreground">
              Features
            </Link>
            <Link to="/how-it-works" className="hover:text-foreground">
              How it works
            </Link>
            <Link to="/about" className="hover:text-foreground">
              About
            </Link>
          </nav>
          <p>The sample bank and insurer are fictional.</p>
        </div>
      </div>
    </footer>
  );
}
