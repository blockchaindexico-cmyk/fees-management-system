import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Small ⓘ that reveals an explanation on hover or keyboard focus.
 * Keeps explanations out of the way so screens stay calm. Pure CSS, works in server components.
 */
export function InfoTip({ children, className, align = "center" }: { children: React.ReactNode; className?: string; align?: "center" | "start" | "end" }) {
  return (
    <span className={cn("no-print group/tip relative inline-flex align-middle", className)}>
      <span
        tabIndex={0}
        role="button"
        aria-label="More information"
        className="inline-flex size-[18px] cursor-help items-center justify-center rounded-full text-muted outline-none transition-colors hover:text-ink-2 focus-visible:text-accent"
      >
        <Info className="size-[15px]" strokeWidth={2} aria-hidden />
      </span>
      <span
        role="tooltip"
        className={cn(
          // display:none until shown, so a tip near the right edge never widens the page
          "pointer-events-none absolute top-full z-50 mt-2 hidden w-max max-w-[280px] rounded-xl bg-surface px-3 py-2 text-left text-footnote font-normal normal-case tracking-normal text-ink-2 shadow-pop transition-opacity duration-150 starting:opacity-0 group-hover/tip:block group-focus-within/tip:block",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}
