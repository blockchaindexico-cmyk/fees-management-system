import type { AppRole } from "@/lib/types";
import type { TileColor } from "@/components/ui/kpi";

export type NavItem = { href: string; label: string; icon: string; color: TileColor; roles?: AppRole[]; match?: string[] };
export type NavGroup = { label: string; items: NavItem[] };

const WRITERS: AppRole[] = ["admin", "accountant"];

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "LayoutGrid", color: "blue" },
      { href: "/monthly", label: "Months", icon: "CalendarDays", color: "red" },
      { href: "/installments", label: "Installments", icon: "Layers", color: "indigo" },
      { href: "/classes", label: "Classes", icon: "School", color: "teal" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/payments", label: "Payments", icon: "Receipt", color: "green" },
      { href: "/pending", label: "Pending fees", icon: "Hourglass", color: "orange" },
      { href: "/students", label: "Students", icon: "Users", color: "blue" },
      { href: "/reports/summary", label: "Owner report", icon: "FileText", color: "gray" },
    ],
  },
  {
    label: "Recovery",
    items: [
      { href: "/recovery", label: "Recovery dashboard", icon: "TrendingUp", color: "green" },
      { href: "/calls", label: "Calls", icon: "PhoneCall", color: "blue" },
      { href: "/activities", label: "Activities", icon: "Sparkles", color: "teal" },
      { href: "/parents", label: "Parents", icon: "UsersRound", color: "indigo" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/setup", label: "Setup", icon: "SlidersHorizontal", color: "gray", roles: WRITERS, match: ["/setup"] },
      { href: "/settings", label: "Settings", icon: "Settings", color: "gray", roles: ["admin", "accountant", "principal"], match: ["/settings", "/admin"] },
    ],
  },
];

export const SETUP_TABS = [
  { href: "/setup", label: "Checklist" },
  { href: "/setup/sessions", label: "Sessions" },
  { href: "/setup/classes", label: "Classes & fees" },
  { href: "/setup/fee-structure", label: "Fee structure" },
  { href: "/setup/promote", label: "Promote" },
  { href: "/setup/import", label: "Import" },
];

export const SETTINGS_TABS: { href: string; label: string; roles?: AppRole[] }[] = [
  { href: "/settings", label: "School", roles: ["admin"] },
  { href: "/settings/staff", label: "Staff", roles: ["admin"] },
  { href: "/admin/reconciliation", label: "Health checks" },
];
