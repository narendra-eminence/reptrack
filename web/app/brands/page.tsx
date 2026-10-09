import { Suspense } from "react";
import { BrandWorkspace } from "@/components/BrandWorkspace";

export default function BrandsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Brand sets</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Stored in url-verification&apos;s config.yaml, shared with the verify_urls.py command line. Each save keeps a backup.
        </p>
      </div>
      {/* BrandWorkspace reads ?set= from the URL. */}
      <Suspense>
        <BrandWorkspace />
      </Suspense>
    </div>
  );
}
