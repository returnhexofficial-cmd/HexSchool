import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { Nothing, PageBanner, RichText, Section } from "../_components/ui";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to the questions parents ask most often.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage() {
  const faqs = await publicSite.faqs();
  const categories = [
    ...new Set((faqs ?? []).map((faq) => faq.category || "General")),
  ];

  // FAQPage structured data — this is the one page type where search
  // engines render the answers directly.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: (faqs ?? []).map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer.replace(/<[^>]*>/g, " ").trim(),
      },
    })),
  };

  return (
    <>
      {faqs && faqs.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      ) : null}
      <PageBanner
        title="Frequently asked questions"
        subtitle="Admission, fees, routines and the rest."
        breadcrumb="FAQ"
      />
      <Section className="max-w-3xl">
        {!faqs || faqs.length === 0 ? (
          <Nothing>No questions have been published yet.</Nothing>
        ) : (
          categories.map((category) => (
            <div key={category} className="mb-8">
              {categories.length > 1 ? (
                <h2 className="mb-3 text-lg font-semibold">{category}</h2>
              ) : null}
              <div className="divide-y rounded-lg border">
                {faqs
                  .filter((faq) => (faq.category || "General") === category)
                  .map((faq) => (
                    <details key={faq.id} className="group p-4">
                      <summary className="cursor-pointer list-none font-medium marker:content-none">
                        <span className="mr-2 text-muted-foreground group-open:hidden">
                          +
                        </span>
                        <span className="mr-2 hidden text-muted-foreground group-open:inline">
                          −
                        </span>
                        {faq.question}
                      </summary>
                      <RichText
                        html={faq.answer}
                        className="mt-3 pl-5 text-sm text-muted-foreground"
                      />
                    </details>
                  ))}
              </div>
            </div>
          ))
        )}
      </Section>
    </>
  );
}
