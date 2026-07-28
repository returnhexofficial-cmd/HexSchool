import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Nothing, PageBanner, Section } from "../_components/ui";
import { DownloadList } from "./download-list";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Downloads",
  description: "Forms, syllabuses, routines and other files to download.",
  alternates: { canonical: "/downloads" },
};

export default async function DownloadsPage() {
  const files = await publicSite.downloads();
  const categories = [
    ...new Set((files ?? []).map((file) => file.category || "Other")),
  ];

  return (
    <>
      <PageBanner
        title="Downloads"
        subtitle="Forms, syllabuses and routines."
        breadcrumb="Downloads"
      />
      <Section>
        {!files || files.length === 0 ? (
          <Nothing>Nothing has been published for download yet.</Nothing>
        ) : (
          categories.map((category) => (
            <div key={category} className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">{category}</h2>
              <DownloadList
                files={files.filter(
                  (file) => (file.category || "Other") === category,
                )}
              />
            </div>
          ))
        )}
      </Section>
    </>
  );
}
