import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  BarChart3,
  Coins,
  LayoutDashboard,
  Megaphone,
  Network,
  ScrollText,
  Settings,
  ShieldAlert,
  Stethoscope,
  Users,
  Users2,
} from "lucide-react";
import type { Permission } from "@aureus/shared";

export type NavBadge = "redemptions" | "orders";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Required permission, or null when always visible. */
  permission: Permission | null;
  badge?: NavBadge;
}

/** Sidebar map (docs/06 §2). Items the principal lacks permission for are not rendered. */
export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard, permission: null },
  { key: "org", label: "Organization", href: "/org", icon: Network, permission: "operator.view_subtree" },
  { key: "operators", label: "Operators", href: "/operators", icon: Users2, permission: "operator.view_subtree" },
  { key: "credits", label: "Credits", href: "/credits", icon: Coins, permission: "order.view", badge: "orders" },
  { key: "players", label: "Players", href: "/players", icon: Users, permission: "player.view" },
  { key: "redemptions", label: "Redemptions", href: "/redemptions", icon: Banknote, permission: "redemption.view", badge: "redemptions" },
  { key: "reports", label: "Reports", href: "/reports", icon: BarChart3, permission: "report.view" },
  { key: "ledger", label: "Ledger health", href: "/ledger", icon: Stethoscope, permission: "report.ledger_health" },
  { key: "compliance", label: "Compliance", href: "/compliance", icon: ShieldAlert, permission: "compliance.view" },
  { key: "audit", label: "Audit", href: "/audit", icon: ScrollText, permission: "audit.view" },
  { key: "announcements", label: "Announcements", href: "/announcements", icon: Megaphone, permission: "announcement.manage" },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];
