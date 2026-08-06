"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CERTIFICATE_TYPE_LABELS,
  certificateApi,
  type PortalCertificate,
} from "@/lib/api/documents";

export interface CertificateFetchers {
  /** Query-key discriminator: `self` or `child-<id>`. */
  key: string;
  get: () => Promise<PortalCertificate[]>;
}

/**
 * "My certificates" (roadmap M27 §5).
 *
 * The student and the parent see **exactly the same thing** — as with the
 * transport and hostel panels there is nothing here anybody can *do*, so
 * there is no `canAct` prop to get wrong.
 *
 * **A revoked certificate stays on the list, marked.** Hiding it would be
 * the obvious choice and is wrong twice: the family is holding the paper,
 * so pretending it does not exist tells them nothing when somebody checks
 * the code and is told REVOKED — and the school's own reason is exactly
 * what they need in order to come and sort it out. A draft never appears
 * at all; it has no number, no code and no public existence.
 */
export function CertificatePanels({
  fetchers,
}: {
  fetchers: CertificateFetchers;
}) {
  const query = useQuery({
    queryKey: ["portal-certificates", fetchers.key],
    queryFn: fetchers.get,
  });

  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;

  const rows = query.data ?? [];

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Certificates</h2>

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No certificates have been issued yet. The office issues these on
          request.
        </p>
      )}

      {rows.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
        >
          <div>
            <div className="font-medium">
              {CERTIFICATE_TYPE_LABELS[row.type]}
              {row.isDuplicate && (
                <Badge variant="outline" className="ml-2">
                  Duplicate
                </Badge>
              )}
              {row.status === "REVOKED" && (
                <Badge variant="destructive" className="ml-2">
                  Revoked
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.certificateNo} · issued {row.issueDate} · verification code{" "}
              <span className="font-mono">{row.verifyCode}</span>
            </div>
            {row.revokedReason && (
              <p className="mt-1 text-xs text-amber-600">
                {row.revokedReason} — please contact the office.
              </p>
            )}
          </div>

          {row.downloadable && row.status !== "REVOKED" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void certificateApi.print(row.id, row.certificateNo)}
            >
              Download
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {row.status === "REVOKED"
                ? "Not available"
                : "Ask the office for a copy"}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
