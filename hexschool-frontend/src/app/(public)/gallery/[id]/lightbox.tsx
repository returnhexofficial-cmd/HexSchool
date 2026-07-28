"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GalleryMedia {
  id: string;
  type: "IMAGE" | "VIDEO_URL";
  url: string;
  caption: string | null;
}

/**
 * Photo grid + full-screen viewer. Videos are embedded URLs (YouTube and
 * friends), so they open in a new tab rather than in the overlay — an
 * iframe here would reintroduce exactly the element the CMS sanitizer
 * strips from authored content.
 */
export function Lightbox({ items }: { items: GalleryMedia[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const images = items.filter((item) => item.type === "IMAGE");
  const active = openIndex === null ? null : images[openIndex];

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenIndex(null);
      if (event.key === "ArrowRight") {
        setOpenIndex((index) =>
          index === null ? null : (index + 1) % images.length,
        );
      }
      if (event.key === "ArrowLeft") {
        setOpenIndex((index) =>
          index === null ? null : (index - 1 + images.length) % images.length,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, images.length]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          if (item.type === "VIDEO_URL") {
            return (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex aspect-4/3 items-center justify-center rounded-lg border bg-muted p-4 text-center text-sm hover:bg-muted/70"
              >
                ▶ {item.caption || "Watch video"}
              </a>
            );
          }
          const index = images.findIndex((image) => image.id === item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group overflow-hidden rounded-lg border"
              aria-label={item.caption || "Open photo"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.caption ?? ""}
                loading="lazy"
                className="aspect-4/3 w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          );
        })}
      </div>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.caption ?? "Photo"}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="absolute right-4 top-4 text-white hover:bg-white/20"
            onClick={() => setOpenIndex(null)}
          >
            <X className="size-5" />
          </Button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.url}
            alt={active.caption ?? ""}
            className="max-h-[80vh] max-w-full rounded object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          {active.caption ? (
            <p className="mt-4 text-center text-sm text-white/80">
              {active.caption}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-white/50">
            {(openIndex ?? 0) + 1} / {images.length} · arrow keys to browse
          </p>
        </div>
      ) : null}
    </>
  );
}
