import type { Ref } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CINEMATIC_EASE, SCENE_MOVE_DURATION, SOFT_EASE } from "@/lib/hero-timeline";

/** Drawing coordinates. The screen is a plain rectangle, so the quad below is exact. */
const W = 1200;
const H = 1000;
const SCREEN = { x: 520, y: 170, w: 600, h: 360 };

/** Monitor screen corners inside the drawing, as fractions of its width/height. */
export const SCREEN_QUAD = [
  [SCREEN.x / W, SCREEN.y / H],
  [(SCREEN.x + SCREEN.w) / W, SCREEN.y / H],
  [(SCREEN.x + SCREEN.w) / W, (SCREEN.y + SCREEN.h) / H],
  [SCREEN.x / W, (SCREEN.y + SCREEN.h) / H],
] as const;

type Props = {
  ref?: Ref<HTMLDivElement>;
  moved: boolean;
  glowing: boolean;
  instant: boolean;
};

const INK = "var(--ink)";
const LINE = {
  stroke: INK,
  strokeWidth: 3,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

/** The reader at the desk: an inked drawing that moves as one unit. */
export function PersonComputerScene({ ref, moved, glowing, instant }: Props) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        layout: { duration: instant ? 0 : SCENE_MOVE_DURATION, ease: CINEMATIC_EASE },
        default: { duration: 1.1, ease: SOFT_EASE, delay: 0.25 },
      }}
      className={cn("scene-slot z-10", moved ? "scene-slot-small" : "scene-slot-large")}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Drawing of a person at a desk, reading a document answer on a monitor"
        className="scene-fade h-full w-full overflow-visible"
      >
        <defs>
          {/* a slight tremor in every edge, the way a pen line wanders */}
          <filter id="pen" x="-2%" y="-2%" width="104%" height="104%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="5" />
          </filter>
          <pattern
            id="mesh"
            width="14"
            height="14"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="14" stroke="#2b3a33" strokeWidth="2" />
          </pattern>
          <pattern id="knit" width="18" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 5 Q4.5 0 9 5 T18 5" fill="none" stroke="#2f4a3f" strokeWidth="1.4" />
          </pattern>
        </defs>

        <g filter="url(#pen)">
          {/* desk surface and front edge */}
          <path d="M350 688 L1200 688 L1200 772 L285 772 Z" fill="#e4e7df" {...LINE} />
          <path d="M285 772 L1200 772 L1200 796 L285 796 Z" fill="#d3d7cd" {...LINE} />

          {/* desk leg */}
          <path d="M1150 796 L1176 796 L1176 1000 L1150 1000 Z" fill="#d3d7cd" {...LINE} />

          {/* monitor stand */}
          <path d="M792 568 L848 568 L864 690 L776 690 Z" fill="#e4e7df" {...LINE} />
          <rect x="716" y="686" width="208" height="14" rx="7" fill="#d3d7cd" {...LINE} />

          {/* monitor */}
          <rect x="500" y="150" width="640" height="420" rx="18" fill={INK} {...LINE} />
          <rect
            x={SCREEN.x}
            y={SCREEN.y}
            width={SCREEN.w}
            height={SCREEN.h}
            rx="4"
            fill="#1f2924"
          />

          {/* what's on screen: a tiny version of the app window */}
          <motion.g
            initial={false}
            animate={{ opacity: glowing ? 1 : 0.35 }}
            transition={{ duration: 0.6, ease: SOFT_EASE }}
          >
            <rect x={SCREEN.x} y={SCREEN.y} width="128" height={SCREEN.h} fill="#141c18" />
            {[204, 230, 256, 282, 308, 334, 360].map((y, i) => (
              <rect
                key={y}
                x="538"
                y={y}
                width={i === 2 ? 92 : 70 + ((i * 13) % 24)}
                height="8"
                rx="4"
                fill={i === 2 ? "#8fcfae" : "#9aa79f"}
                opacity={i === 2 ? 0.9 : 0.35}
              />
            ))}
            <rect x="908" y="196" width="190" height="30" rx="10" fill="#2b3a33" />
            <rect x="676" y="250" width="300" height="9" rx="4.5" fill="#e9ede6" opacity="0.8" />
            <rect x="676" y="270" width="210" height="9" rx="4.5" fill="#e9ede6" opacity="0.8" />
            <rect
              x="676"
              y="300"
              width="420"
              height="78"
              rx="10"
              fill="none"
              stroke="#e9ede6"
              strokeOpacity="0.16"
              strokeWidth="2"
            />
            <rect x="694" y="318" width="250" height="9" rx="4.5" fill="#9aa79f" opacity="0.5" />
            <rect x="694" y="340" width="210" height="14" rx="3" fill="#f3e04e" />
            <circle cx="684" cy="402" r="7" fill="#8fcfae" />
            <rect x="698" y="398" width="150" height="8" rx="4" fill="#8fcfae" opacity="0.7" />
            <rect x="660" y="484" width="440" height="30" rx="9" fill="#222d28" />
          </motion.g>

          {/* papers on the desk, one line marked with a highlighter */}
          <path d="M960 708 L1150 700 L1170 744 L978 752 Z" fill="#f8f9f5" {...LINE} />
          <path d="M1000 718 L1110 714" stroke="#f3e04e" strokeWidth="9" strokeLinecap="round" />
          <path
            d="M1004 732 L1130 727"
            stroke={INK}
            strokeOpacity="0.35"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* keyboard */}
          <path d="M700 706 L930 704 L944 728 L690 730 Z" fill="#d3d7cd" {...LINE} />

          {/* mug */}
          <path
            d="M1058 628 L1112 628 L1108 690 C1108 696 1104 698 1098 698 L1072 698 C1066 698 1062 696 1062 690 Z"
            fill="#f8f9f5"
            {...LINE}
          />
          <path d="M1111 642 C1134 642 1134 674 1109 674" fill="none" {...LINE} />

          {/* the reader: shoulders and sweater */}
          <path
            d="M48 1000 C52 840 84 676 176 610 C214 584 246 560 262 520 L340 520 C356 560 392 584 444 604 C520 632 560 690 574 760 C586 830 590 920 592 1000 Z"
            fill="#3f5a4f"
            {...LINE}
          />
          <path
            d="M48 1000 C52 840 84 676 176 610 C214 584 246 560 262 520 L340 520 C356 560 392 584 444 604 C520 632 560 690 574 760 C586 830 590 920 592 1000 Z"
            fill="url(#knit)"
            opacity="0.5"
          />
          {/* ribbed collar */}
          <path d="M250 528 C270 552 330 552 352 528" fill="none" {...LINE} />

          {/* neck and ears */}
          <path d="M264 436 L338 436 L344 528 L256 528 Z" fill="#c8ab92" {...LINE} />
          <ellipse cx="212" cy="362" rx="13" ry="24" fill="#c8ab92" {...LINE} />
          <ellipse cx="390" cy="362" rx="13" ry="24" fill="#c8ab92" {...LINE} />

          {/* back of the head */}
          <path
            d="M300 244 C362 242 396 290 394 352 C392 404 372 444 338 456 C316 464 284 464 262 456 C226 444 206 402 208 350 C210 290 240 246 300 244 Z"
            fill={INK}
            {...LINE}
          />
          <path
            d="M300 262 C290 300 286 330 290 368 M322 266 C334 300 338 334 334 372 M278 272 C262 304 254 336 256 372 M344 286 C356 314 360 344 356 380"
            fill="none"
            stroke="#3a4a43"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* chair back, nearest to us */}
          <path
            d="M66 1000 L80 790 C84 760 108 744 138 744 L500 744 C530 744 552 760 556 790 L572 1000 Z"
            fill={INK}
            {...LINE}
          />
          <path
            d="M66 1000 L80 790 C84 760 108 744 138 744 L500 744 C530 744 552 760 556 790 L572 1000 Z"
            fill="url(#mesh)"
          />

          {/* right arm reaching for the keyboard, over the chair's edge */}
          <path
            d="M452 612 C524 636 610 668 700 708 C708 716 704 728 692 732 C640 736 590 726 548 712 C512 700 486 676 470 650 Z"
            fill="#3f5a4f"
            {...LINE}
          />
          <ellipse cx="706" cy="716" rx="20" ry="11" fill="#c8ab92" {...LINE} />
        </g>
      </svg>
    </motion.div>
  );
}
