"use client";

import { useState } from "react";
import { Download as DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownloadCard } from "@/lib/api/public-site";
import { publicSiteApi } from "@/lib/api/website";
import { formatBytes } from "../_components/ui";

/**
 * Download rows. Clicking asks the API to count the hit and hand back the
 * file URL, then opens it — the counter moves in the database, so it can
 * never be inflated by a client that simply re-renders. If the counter
 * call fails, the file still opens: a broken statistic must not stand
 * between a parent and an admission form.
 */
export function DownloadList({ files }: { files: DownloadCard[] }) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const open = async (file: DownloadCard) => {
    let url = file.fileUrl;
    try {
      const result = await publicSiteApi.registerDownload(file.id);
      url = result.fileUrl;
      setCounts((prev) => ({ ...prev, [file.id]: result.downloadCount }));
    } catch {
      // counting is best-effort
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <ul className="divide-y rounded-lg border">
      {files.map((file) => (
        <li
          key={file.id}
          className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{file.title}</p>
            <p className="text-xs text-muted-foreground">
              {[
                formatBytes(file.sizeBytes),
                `${counts[file.id] ?? file.downloadCount} downloads`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void open(file)}>
            <DownloadIcon className="mr-1.5 size-4" />
            Download
          </Button>
        </li>
      ))}
    </ul>
  );
}
