"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CareersTab,
  CommitteeTab,
  FaqsTab,
  GalleriesTab,
  NewsTab,
  PagesTab,
} from "./content-tabs";
import { DownloadsTab } from "./downloads-tab";
import { MessagesTab } from "./messages-tab";

/**
 * The Website CMS workspace (Module 19). Eight tabs over the public
 * site's content, plus a link out to the live site. Site-wide settings
 * (hero slides, socials, SEO, verification toggles) live in the
 * `website` group on /admin/settings, like every other settings group.
 */
const TABS = [
  ["pages", "Pages"],
  ["news", "News"],
  ["galleries", "Gallery"],
  ["downloads", "Downloads"],
  ["committee", "Committee"],
  ["careers", "Careers"],
  ["faqs", "FAQ"],
  ["messages", "Messages"],
] as const;

type TabKey = (typeof TABS)[number][0];

export default function WebsitePage() {
  const [tab, setTab] = useState<TabKey>("pages");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Website"
        description="The public site: pages, news, gallery, downloads, careers, FAQ and the contact inbox."
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/settings">Site settings</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/" target="_blank">
            View site
            <ExternalLink className="ml-1.5 size-4" />
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "pages" ? <PagesTab /> : null}
      {tab === "news" ? <NewsTab /> : null}
      {tab === "galleries" ? <GalleriesTab /> : null}
      {tab === "downloads" ? <DownloadsTab /> : null}
      {tab === "committee" ? <CommitteeTab /> : null}
      {tab === "careers" ? <CareersTab /> : null}
      {tab === "faqs" ? <FaqsTab /> : null}
      {tab === "messages" ? <MessagesTab /> : null}
    </main>
  );
}
