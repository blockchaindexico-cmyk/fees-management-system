"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays, FileText, Hourglass, IndianRupee, Layers, LayoutGrid, Menu, PhoneCall, Receipt, School, Settings,
  SlidersHorizontal, Sparkles, TrendingUp, Users, UsersRound, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppRole } from "@/lib/types";
import { IconTile } from "@/components/ui/kpi";
import { NAV } from "./nav";

const ICONS: Record<string, React.ElementType> = {
  CalendarDays, FileText, Hourglass, Layers, LayoutGrid, PhoneCall, Receipt, School, Settings, SlidersHorizontal, Sparkles, TrendingUp, Users,
  UsersRound,
};

function isActive(pathname: string, href: string, match?: string[]) {
  if (match) return match.some((m) => pathname === m || pathname.startsWith(m + "/"));
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ role, schoolName, canCollect }: { role: AppRole; schoolName: string; canCollect: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const collectActive = pathname.startsWith("/collect");

  const nav = (
    <nav
      className="flex flex-col gap-6 px-3 pb-6"
      aria-label="Main"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) setOpen(false);
      }}
    >
      {canCollect && (
        <Link
          href="/collect"
          aria-current={collectActive ? "page" : undefined}
          className={cn(
            "mx-1 flex h-10 items-center justify-center gap-2 rounded-full bg-accent text-subhead font-semibold text-accent-ink shadow-[0_2px_8px_rgba(0,113,227,0.3)] transition-all hover:bg-accent-strong active:scale-[0.98]",
          )}
        >
          <IndianRupee className="size-4" strokeWidth={2.4} /> Collect fee
        </Link>
      )}
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.roles || i.roles.includes(role));
        if (items.length === 0) return null;
        return (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-caption font-semibold text-muted">{g.label}</p>
            <ul className="space-y-0.5">
              {items.map((i) => {
                const Icon = ICONS[i.icon] ?? LayoutGrid;
                const active = isActive(pathname, i.href, i.match);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-[10px] px-2 py-[7px] text-subhead transition-colors",
                        active ? "bg-fill font-semibold text-ink" : "text-ink hover:bg-fill-2",
                      )}
                    >
                      <IconTile icon={Icon} color={i.color} size="sm" />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-3 px-5 pb-5 pt-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-b from-[#2c8cff] to-[#0062c4] text-[17px] font-bold text-white shadow-[0_2px_6px_rgba(0,98,196,0.35)]">
        ₹
      </span>
      <span className="min-w-0">
        <span className="block truncate text-subhead font-semibold leading-tight text-ink">{schoolName}</span>
        <span className="block text-caption text-muted">Fees</span>
      </span>
    </Link>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed left-3 top-[10px] z-40 inline-flex size-9 items-center justify-center rounded-full bg-fill text-ink backdrop-blur lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-y-auto border-r border-line bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] backdrop-blur-2xl lg:flex">
        {brand}
        {nav}
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 flex w-[280px] flex-col overflow-y-auto bg-surface shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-full p-1.5 text-ink-2 hover:bg-fill">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
