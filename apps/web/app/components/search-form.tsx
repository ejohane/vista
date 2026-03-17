"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Label } from "@/components/ui/label";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarInput,
} from "@/components/ui/sidebar";

type SearchFormProps = Omit<React.ComponentProps<"form">, "onChange"> & {
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  value?: string;
};

export function SearchForm({
  disabled,
  onSubmit,
  onValueChange,
  placeholder = "Search...",
  value,
  ...props
}: SearchFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(event);
      }}
      {...props}
    >
      <SidebarGroup className="py-0">
        <SidebarGroupContent className="relative">
          <Label htmlFor="search" className="sr-only">
            Search
          </Label>
          <SidebarInput
            disabled={disabled}
            id="search"
            onChange={(event) => onValueChange?.(event.target.value)}
            placeholder={placeholder}
            className="pl-8"
            value={value ?? ""}
          />
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
        </SidebarGroupContent>
      </SidebarGroup>
    </form>
  );
}
