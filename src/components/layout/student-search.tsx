"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { IndianRupee, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch, apiUrl } from "@/lib/api/client";
import { Avatar } from "@/components/ui/avatar";
import type { SearchResult } from "@/lib/types";

/**
 * Fast student lookup by name, admission no, father's name or phone.
 * Ctrl/⌘+K focuses it from anywhere. Enter opens the highlighted student; in "pick" mode it hands the student
 * to `onPick` instead (adding a child to a family, a student to an activity).
 */
export function StudentSearch({
  mode = "profile",
  autoFocus = false,
  placeholder = "Search student, admission no, father, phone…",
  className,
  large = false,
  canCollect = true,
  onPick,
}: {
  mode?: "profile" | "collect" | "pick";
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  large?: boolean;
  canCollect?: boolean;
  onPick?: (student: SearchResult) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (mode !== "profile") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiFetch<SearchResult[]>(apiUrl("/api/students/search", { q: term, limit: 12 }), { signal: ctrl.signal });
        if (Array.isArray(data)) {
          setResults(data);
          setHi(0);
          setOpen(true);
        }
      } catch {
        /* aborted or offline */
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const shown = q.trim() ? results : [];
  const target = (r: SearchResult) => (mode === "collect" ? `/collect/${r.id}` : `/students/${r.id}`);

  function go(r: SearchResult) {
    setOpen(false);
    setQ("");
    if (mode === "pick") onPick?.(r);
    else router.push(target(r));
  }

  return (
    <div className={cn("relative", className)}>
      <Search className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted", large ? "left-4 size-5" : "left-3 size-4")} aria-hidden />
      <input
        ref={inputRef}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => shown.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && shown[hi]) {
            e.preventDefault();
            go(shown[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Search students"
        placeholder={placeholder}
        className={cn(
          "w-full text-ink placeholder:text-muted transition-colors focus:outline-none",
          large
            ? "h-14 rounded-2xl bg-surface pl-12 pr-4 text-title3 shadow-card focus:ring-4 focus:ring-accent/15"
            : "h-9 rounded-full bg-fill-2 pl-9 pr-3 text-subhead hover:bg-fill focus:bg-surface focus:ring-4 focus:ring-accent/15 sm:pr-14",
        )}
      />
      {!large && mode === "profile" && (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md bg-surface px-1.5 py-px font-sans text-[11px] font-medium text-muted shadow-[0_0_0_1px_var(--line)] sm:block">
          ⌘K
        </kbd>
      )}
      {open && q.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="animate-rise absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl bg-glass p-1.5 shadow-pop backdrop-blur-2xl"
        >
          {shown.length === 0 && (
            <li className="px-3 py-3 text-subhead text-ink-2">{loading ? "Searching…" : "No student found"}</li>
          )}
          {shown.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === hi}>
              <div className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", i === hi && "bg-fill")} onMouseEnter={() => setHi(i)}>
                <Avatar name={r.full_name} size="md" />
                <Link
                  href={target(r)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    if (mode === "pick") e.preventDefault();
                    go(r);
                  }}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-subhead font-semibold text-ink">
                    {r.full_name} <span className="font-normal text-muted">· {r.admission_no}</span>
                    {r.status !== "active" && <span className="ml-1 text-caption font-normal text-muted">({r.status.replace("_", " ")})</span>}
                  </span>
                  <span className="block truncate text-caption text-ink-2">
                    {r.class_name ? `${r.class_name}${r.section ? "-" + r.section : ""}` : "No class"}
                    {r.roll_no ? ` · Roll ${r.roll_no}` : ""}
                    {r.father_name ? ` · ${r.father_name}` : ""}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </span>
                </Link>
                {mode === "profile" && canCollect && (
                  <Link
                    href={`/collect/${r.id}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setOpen(false)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-caption font-semibold text-accent-ink hover:bg-accent-strong"
                  >
                    <IndianRupee className="size-3.5" aria-hidden /> Collect
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
