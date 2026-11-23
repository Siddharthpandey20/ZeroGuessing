import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { SOFT_EASE } from "@/lib/hero-timeline";
import { BrandMark } from "./BrandMark";

const links = [
  { to: "/", label: "Home" },
  { to: "/features", label: "Features" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/about", label: "About" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: SOFT_EASE, delay: 0.1 }}
      className="absolute inset-x-0 top-0 z-50"
    >
      <nav className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-6 md:px-10">
        <Link to="/" className="group flex items-center gap-2.5 text-foreground">
          <BrandMark className="h-7 w-7 transition-transform duration-500 group-hover:-rotate-6" />
          <span className="font-display text-[19px] font-semibold">{BRAND_NAME}</span>
        </Link>

        <div className="flex items-center gap-8">
          <ul className="hidden items-center gap-8 text-[15px] md:flex">
            {links.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="nav-link" activeOptions={{ exact: true }}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/app" className="btn-quiet px-4 py-1.5 text-[15px]">
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="btn-quiet grid h-9 w-9 place-items-center md:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: SOFT_EASE }}
            className="absolute right-6 top-20 flex min-w-48 flex-col gap-1 rounded-lg border border-border bg-popover p-2 text-[15px] shadow-lg md:hidden"
          >
            {links.map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setOpen(false)}
                  activeOptions={{ exact: true }}
                  className="block rounded-md px-4 py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:text-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
