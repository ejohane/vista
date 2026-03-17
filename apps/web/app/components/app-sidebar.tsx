import {
  ArrowsClockwiseIcon,
  CoinsIcon,
  DatabaseIcon,
  HouseLineIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type * as React from "react";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export type AppSidebarSection = {
  items: Array<{
    badge?: string;
    href: string;
    isActive?: boolean;
    title: string;
  }>;
  title: string;
};

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  helperText: string;
  searchDisabled?: boolean;
  searchPlaceholder: string;
  searchValue: string;
  sections: AppSidebarSection[];
  status: "empty" | "ready";
  summary: Array<{
    label: string;
    value: string;
  }>;
  subtitle: string;
  title: string;
  onSearchValueChange: (value: string) => void;
};

export function AppSidebar({
  helperText,
  onSearchValueChange,
  searchDisabled,
  searchPlaceholder,
  searchValue,
  sections,
  status,
  subtitle,
  summary,
  title,
  ...props
}: AppSidebarProps) {
  const StatusIcon = status === "ready" ? HouseLineIcon : WarningCircleIcon;

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<div />}
              size="lg"
              className="h-auto items-start gap-3 rounded-2xl border border-sidebar-border/80 bg-background/70 px-3 py-3 shadow-sm hover:bg-background"
            >
              <div className="flex size-8 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
                <StatusIcon className="size-4" />
              </div>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-semibold">{title}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {subtitle}
                </span>
              </div>
              <Badge
                variant="outline"
                className="border-sidebar-border bg-background/80 text-sidebar-foreground"
              >
                {status === "ready" ? "Live" : "Seeding"}
              </Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SearchForm
          disabled={searchDisabled}
          onValueChange={onSearchValueChange}
          placeholder={searchPlaceholder}
          value={searchValue}
        />
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={item.isActive}
                      // biome-ignore lint/a11y/useAnchorContent: SidebarMenuButton injects the visible link text through its children.
                      render={<a aria-label={item.title} href={item.href} />}
                    >
                      {item.title}
                    </SidebarMenuButton>
                    {item.badge ? (
                      <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-3">
        <SidebarSeparator />
        <div className="grid grid-cols-2 gap-2 px-2">
          {summary.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-sidebar-border/80 bg-background/70 p-3 shadow-sm"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-sidebar-foreground/60">
                {item.label}
              </p>
              <p className="mt-2 text-sm font-semibold text-sidebar-foreground">
                {item.value}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-2 px-2 pb-2">
          <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
            <DatabaseIcon className="size-3.5" />
            <span>Cloudflare D1 snapshot</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
            {status === "ready" ? (
              <CoinsIcon className="size-3.5" />
            ) : (
              <ArrowsClockwiseIcon className="size-3.5" />
            )}
            <span>{helperText}</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
