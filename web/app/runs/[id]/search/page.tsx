"use client";

import { SearchStep } from "@/components/SearchStep";
import { useRunContext } from "@/lib/RunContext";

export default function SearchPage() {
  const { run, refetch } = useRunContext();
  return <SearchStep run={run} refetch={refetch} />;
}
