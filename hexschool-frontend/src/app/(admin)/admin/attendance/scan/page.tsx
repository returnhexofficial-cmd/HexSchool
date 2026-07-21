"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { attendanceApi, type QrCheckinResult } from "@/lib/api/attendance";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/validations/attendance";

/**
 * `BarcodeDetector` is a browser API (Chrome/Edge/Android), not a
 * TypeScript lib type — declared minimally here rather than pulling a
 * scanner dependency in. Browsers without it fall back to the manual
 * token entry below, which works everywhere (including a USB scanner
 * typing into the field).
 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

const SUCCESS_STYLES: Record<string, string> = {
  PRESENT: "border-emerald-500/50 bg-emerald-500/10",
  LATE: "border-amber-500/50 bg-amber-500/10",
  HALF_DAY: "border-violet-500/50 bg-violet-500/10",
};

export default function QrScanPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [result, setResult] = useState<QrCheckinResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const checkin = useMutation({
    mutationFn: (token: string) => attendanceApi.qrCheckin(token),
    onSuccess: (data) => {
      setResult(data);
      setFailure(null);
      toast.success(
        data.marked
          ? `${data.student.name} — ${ATTENDANCE_STATUS_LABELS[data.status]}`
          : `${data.student.name} was already marked today.`,
      );
    },
    onError: (err) => {
      setResult(null);
      setFailure(apiErrorMessage(err));
    },
  });

  const submitToken = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      if (!trimmed) return;
      // Client-side burst guard: a camera fires the same code many times
      // a second. (The server also dedupes, per attendance settings.)
      const last = lastTokenRef.current;
      if (last && last.token === trimmed && Date.now() - last.at < 4000) return;
      lastTokenRef.current = { token: trimmed, at: Date.now() };
      checkin.mutate(trimmed);
    },
    [checkin],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const Detector = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    if (!Detector) {
      setCameraError(
        "This browser has no built-in QR detector. Use the manual entry below (a USB scanner types into it) or open this page in Chrome on Android.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) submitToken(codes[0].rawValue);
        } catch {
          // A dropped frame is normal — keep the loop alive.
        }
        if (streamRef.current) setTimeout(() => void tick(), 400);
      };
      void tick();
    } catch {
      setCameraError(
        "Camera access was denied or unavailable. Use the manual entry below.",
      );
      stopCamera();
    }
  }, [stopCamera, submitToken]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="QR check-in"
        description="Scan a student ID card to mark them present. Late arrivals are graded automatically from the shift start time."
      >
        {scanning ? (
          <Button variant="outline" onClick={stopCamera}>
            Stop camera
          </Button>
        ) : (
          <Button onClick={() => void startCamera()}>Start camera</Button>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="aspect-video overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                className="size-full object-cover"
                playsInline
                muted
              />
            </div>
            {cameraError ? (
              <p className="text-sm text-muted-foreground">{cameraError}</p>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="qr-token">Manual / scanner entry</Label>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitToken(manualToken);
                  setManualToken("");
                }}
              >
                <Input
                  id="qr-token"
                  autoFocus
                  value={manualToken}
                  placeholder="Paste or scan the card token"
                  onChange={(e) => setManualToken(e.target.value)}
                />
                <Button type="submit" disabled={checkin.isPending}>
                  {checkin.isPending ? (
                    <Spinner className="mr-1 size-4" />
                  ) : null}
                  Check in
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card
          className={
            result ? SUCCESS_STYLES[result.status] : failure ? "border-destructive/50 bg-destructive/10" : undefined
          }
        >
          <CardContent className="pt-6">
            {checkin.isPending ? (
              <div className="flex justify-center py-16">
                <Spinner className="size-8" />
              </div>
            ) : result ? (
              <div className="space-y-3 text-center">
                {result.student.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.student.photoUrl}
                    alt={result.student.name}
                    className="mx-auto size-28 rounded-full object-cover"
                  />
                ) : (
                  <div className="mx-auto flex size-28 items-center justify-center rounded-full bg-muted text-2xl">
                    {result.student.name.slice(0, 1)}
                  </div>
                )}
                <p className="text-2xl font-semibold">{result.student.name}</p>
                <p className="text-sm text-muted-foreground">
                  {result.student.studentUid} · {result.student.className}{" "}
                  {result.student.sectionName} · Roll {result.student.rollNo}
                </p>
                <div className="flex justify-center gap-2">
                  <Badge>{ATTENDANCE_STATUS_LABELS[result.status]}</Badge>
                  {result.minutesLate > 0 ? (
                    <Badge variant="secondary">
                      {result.minutesLate} min late
                    </Badge>
                  ) : null}
                  {!result.marked ? (
                    <Badge variant="outline">already marked</Badge>
                  ) : null}
                </div>
              </div>
            ) : failure ? (
              <div className="space-y-2 py-12 text-center">
                <p className="text-4xl">✕</p>
                <p className="font-medium">{failure}</p>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Scan a card to see the student here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
