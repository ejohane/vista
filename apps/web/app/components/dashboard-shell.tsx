import {
  ArrowsClockwiseIcon,
  ChartLineUpIcon,
  DatabaseIcon,
  GearSixIcon,
  HouseLineIcon,
  ListIcon,
  XIcon,
} from "@phosphor-icons/react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: typeof HouseLineIcon;
  label: string;
};

const mainNav: NavItem[] = [
  { href: "/", icon: HouseLineIcon, label: "Overview" },
  { href: "/portfolio", icon: ChartLineUpIcon, label: "Portfolio" },
  { href: "/accounts/review", icon: GearSixIcon, label: "Accounts" },
];

const connectNav: NavItem[] = [
  { href: "/connect/plaid", icon: DatabaseIcon, label: "Plaid" },
  { href: "/connect/simplefin", icon: ListIcon, label: "SimpleFIN" },
  { href: "/connect/snaptrade", icon: ArrowsClockwiseIcon, label: "SnapTrade" },
];

function isActive(activePath: string, href: string) {
  if (href === "/") return activePath === "/";
  return activePath === href || activePath.startsWith(`${href}/`);
}

function NavLink({ activePath, item }: { activePath: string; item: NavItem }) {
  const active = isActive(activePath, item.href);
  const Icon = item.icon;

  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <Icon className="size-[18px]" weight={active ? "fill" : "regular"} />
      {item.label}
    </a>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-amber-500/20">
        <span className="vista-display text-[11px] font-bold uppercase tracking-widest text-white drop-shadow-sm">
          V
        </span>
      </div>
      <span className="vista-display text-lg text-foreground">Vista</span>
    </div>
  );
}

function SidebarContent({ activePath }: { activePath: string }) {
  return (
    <>
      <div className="space-y-1">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
          Menu
        </p>
        {mainNav.map((item) => (
          <NavLink key={item.href} activePath={activePath} item={item} />
        ))}
      </div>

      <div className="space-y-1">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
          Connections
        </p>
        {connectNav.map((item) => (
          <NavLink key={item.href} activePath={activePath} item={item} />
        ))}
      </div>
    </>
  );
}

export function DashboardShell({
  activePath,
  children,
}: {
  activePath: string;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[240px] shrink-0 flex-col border-r border-border/50 bg-sidebar">
        <div className="p-5">
          <BrandMark />
        </div>

        <nav className="flex-1 space-y-6 px-3 pt-2 pb-4">
          <SidebarContent activePath={activePath} />
        </nav>

        <div className="border-t border-border/50 px-5 py-4">
          <p className="text-[11px] text-muted-foreground/60">
            Household finance
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed top-0 right-0 left-0 z-40 flex h-14 items-center justify-between border-b border-border/50 bg-background/95 px-4 backdrop-blur-xl lg:hidden">
        <BrandMark />
        <button
          type="button"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          {mobileNavOpen ? (
            <XIcon className="size-5" />
          ) : (
            <ListIcon className="size-5" weight="bold" />
          )}
        </button>
      </div>

      {/* Mobile nav overlay */}
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="fixed top-14 right-0 bottom-0 z-30 w-[260px] overflow-y-auto border-l border-border/50 bg-sidebar p-4 lg:hidden">
            <nav className="space-y-6">
              <SidebarContent activePath={activePath} />
            </nav>
          </div>
        </>
      ) : null}

      {/* Main content */}
      <main className="min-w-0 flex-1 pt-14 lg:pt-0">{children}</main>
    </div>
  );
}
