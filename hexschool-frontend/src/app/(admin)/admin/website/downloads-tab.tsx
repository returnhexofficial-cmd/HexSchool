"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { websiteApi } from "@/lib/api/website";
import { DownloadsTabTable } from "./content-tabs";

/**
 * Downloads: the file goes up first (its own endpoint), then the row is
 * created with the returned URL, key and size. Two steps rather than one
 * multipart create, so a re-upload of the same file can replace it
 * without re-typing the metadata.
 */
export function DownloadsTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{
    fileUrl: string;
    sizeBytes: number;
  } | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await websiteApi.uploadDownload(file);
      setUploaded(result);
      await navigator.clipboard?.writeText(result.fileUrl).catch(() => undefined);
      toast.success(
        "File uploaded — its URL is copied. Paste it into a new file row.",
      );
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <Can permission="website.download.manage">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="mr-1.5 size-4" />
            {uploading ? "Uploading…" : "Upload a file"}
          </Button>
          <p className="text-sm text-muted-foreground">
            PDF, Word, Excel, JPG or PNG up to 20 MB.
          </p>
          {uploaded ? (
            <code className="ml-auto max-w-md truncate text-xs text-muted-foreground">
              {uploaded.fileUrl}
            </code>
          ) : null}
        </div>
      </Can>

      <DownloadsTabTable />
    </div>
  );
}
