"use client";

import { RotateCcw, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Option = {
  id: string;
  name: string;
};

type MemberFiltersProps = {
  homecells: Option[];
};

export function MemberFilters({ homecells }: MemberFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const querySearch = searchParams.get("q") ?? "";
  const queryHomecellId = searchParams.get("homecellId") ?? "";
  const [search, setSearch] = useState(querySearch);

  useEffect(() => {
    setSearch(querySearch);
  }, [querySearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search === querySearch) return;
      const params = new URLSearchParams(searchParams.toString());
      if (search) params.set("q", search);
      else params.delete("q");
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`);
    }, 350);

    return () => clearTimeout(timer);
  }, [search, querySearch, pathname, router, searchParams]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  function resetFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("homecellId");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  const hasActiveFilters = Boolean(querySearch || queryHomecellId);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, email..."
            className="bg-white pl-9"
          />
        </div>
        <Select
          value={queryHomecellId}
          onChange={(event) => updateFilter("homecellId", event.target.value)}
          className="bg-white"
        >
          <option value="">All homecells</option>
          {homecells.map((homecell) => (
            <option key={homecell.id} value={homecell.id}>
              {homecell.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={resetFilters}
          disabled={!hasActiveFilters}
          className="w-full md:w-auto"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}

