"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  VISITOR_PURPOSES,
  VISITOR_PURPOSE_LABELS,
  visitorApi,
  type VisitorHost,
  type VisitorPurpose,
} from "@/lib/api/community";

/**
 * Roadmap §5's "visitor desk screen (fast form, camera capture, gate pass
 * print, live in-building list, checkout button)".
 *
 * **The form is deliberately short and the list is deliberately loud.**
 * The person using this screen has somebody standing in front of them, so
 * check-in is name, phone, purpose and who they came to see — everything
 * else is optional and sits below. The in-building list is what the screen
 * is really for, and it carries a checkout button on every row because the
 * single most common failure of a paper gate book is that nobody signs out.
 *
 * **The photo is a URL, not a webcam capture.** Roadmap §4 offers the
 * camera as optional; the media-library gap this codebase has carried
 * since M19 means there is nowhere to put the captured frame, so the field
 * takes a reference and the capture waits for that library.
 */
export function DeskTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<VisitorPurpose>("MEETING");
  const [hostKey, setHostKey] = useState("");
  const [whomToMeet, setWhomToMeet] = useState("");
  const [nid, setNid] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [remarks, setRemarks] = useState("");

  const inside = useQuery({
    queryKey: ["visitors", "inside"],
    queryFn: () => visitorApi.inside(),
    refetchInterval: 60_000,
  });

  const hosts = useQuery({
    queryKey: ["visitors", "hosts"],
    queryFn: () => visitorApi.hosts(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["visitors"] });

  const checkIn = useMutation({
    mutationFn: () => {
      const host = (hosts.data ?? []).find(
        (h: VisitorHost) => `${h.hostType}:${h.hostId}` === hostKey,
      );
      return visitorApi.checkIn({
        name,
        phone,
        purpose,
        nid: nid || undefined,
        hostType: host?.hostType,
        hostId: host?.hostId,
        whomToMeet: whomToMeet || undefined,
        validUntil: validUntil || undefined,
        remarks: remarks || undefined,
      });
    },
    onSuccess: (visitor) => {
      toast.success(
        visitor.gatePassNo
          ? `${visitor.name} checked in — pass ${visitor.gatePassNo}`
          : `${visitor.name} checked in`,
      );
      setName("");
      setPhone("");
      setNid("");
      setWhomToMeet("");
      setValidUntil("");
      setRemarks("");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const checkOut = useMutation({
    mutationFn: (id: string) => visitorApi.checkOut(id),
    onSuccess: (visitor) => {
      toast.success(`${visitor.name} signed out`);
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const canSubmit = name.trim().length >= 2 && /^01[3-9]\d{8}$/.test(phone);

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* ── the fast form ──────────────────────────────────────────── */}
      <Can permission="visitor.manage">
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Check somebody in</p>

          <div className="space-y-1.5">
            <Label htmlFor="v-name">Name</Label>
            <Input
              id="v-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-phone">Mobile</Label>
            <Input
              id="v-phone"
              placeholder="01XXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-purpose">Purpose</Label>
            <select
              id="v-purpose"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as VisitorPurpose)}
            >
              {VISITOR_PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {VISITOR_PURPOSE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-host">To meet</Label>
            <select
              id="v-host"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={hostKey}
              onChange={(e) => setHostKey(e.target.value)}
            >
              <option value="">Not a specific person</option>
              {(hosts.data ?? []).map((host: VisitorHost) => (
                <option
                  key={`${host.hostType}:${host.hostId}`}
                  value={`${host.hostType}:${host.hostId}`}
                >
                  {host.name}
                  {host.designation ? ` — ${host.designation}` : ""}
                </option>
              ))}
            </select>
          </div>

          {!hostKey && (
            <div className="space-y-1.5">
              <Label htmlFor="v-whom">Or who they asked for</Label>
              <Input
                id="v-whom"
                placeholder="the store room, my daughter's class teacher…"
                value={whomToMeet}
                onChange={(e) => setWhomToMeet(e.target.value)}
              />
            </div>
          )}

          <details className="pt-1">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              More
            </summary>
            <div className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="v-nid">NID</Label>
                <Input
                  id="v-nid"
                  value={nid}
                  onChange={(e) => setNid(e.target.value)}
                />
              </div>

              {/* Roadmap §8: only an OFFICIAL visit earns a multi-day pass,
                  so the field only appears for one. */}
              {purpose === "OFFICIAL" && (
                <div className="space-y-1.5">
                  <Label htmlFor="v-until">Pass valid until</Label>
                  <Input
                    id="v-until"
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    For an external invigilator or contractor coming back
                    over several days.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="v-remarks">Remarks</Label>
                <Textarea
                  id="v-remarks"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>
          </details>

          <Button
            className="w-full"
            disabled={!canSubmit || checkIn.isPending}
            onClick={() => checkIn.mutate()}
          >
            {checkIn.isPending ? "Checking in…" : "Check in"}
          </Button>
        </div>
      </Can>

      {/* ── the live board ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            In the building ({inside.data?.length ?? 0})
          </p>
        </div>

        {inside.isLoading ? (
          <LoadingBlock />
        ) : inside.isError ? (
          <ErrorState onRetry={() => void inside.refetch()} />
        ) : (inside.data ?? []).length === 0 ? (
          <EmptyState
            title="Nobody is signed in"
            description="Checked-in visitors appear here until they sign out."
          />
        ) : (
          <div className="space-y-2">
            {(inside.data ?? []).map((visitor) => (
              <div
                key={visitor.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {visitor.name}
                    {visitor.gatePassNo && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {visitor.gatePassNo}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {VISITOR_PURPOSE_LABELS[visitor.purpose]} ·{" "}
                    {visitor.hostName ?? "—"} · in{" "}
                    {new Date(visitor.checkIn).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    ({visitor.durationMinutes} min)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {visitor.validUntil && (
                    <Badge variant="outline">
                      Pass to{" "}
                      {new Date(visitor.validUntil).toLocaleDateString()}
                    </Badge>
                  )}
                  <Can permission="visitor.manage">
                    {visitor.gatePassNo && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void visitorApi.printGatePass(
                            visitor.id,
                            visitor.gatePassNo,
                          )
                        }
                      >
                        Pass
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={checkOut.isPending}
                      onClick={() => checkOut.mutate(visitor.id)}
                    >
                      Check out
                    </Button>
                  </Can>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
