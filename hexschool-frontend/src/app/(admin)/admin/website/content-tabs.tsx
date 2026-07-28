"use client";

import { Badge } from "@/components/ui/badge";
import {
  websiteApi,
  type Career,
  type CmsPage,
  type CommitteeMember,
  type DownloadFile,
  type Faq,
  type Gallery,
  type NewsPost,
} from "@/lib/api/website";
import {
  CMS_TEMPLATES,
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  WEB_CONTENT_STATUSES,
  WEB_CONTENT_STATUS_LABELS,
} from "@/lib/validations/website";
import { CmsCrud, StatusBadge, type CmsField } from "./cms-crud";

/**
 * The seven content tabs of the Website CMS. Each is a `CmsCrud` config —
 * fields, columns and the API calls — so the behaviour (search, publish
 * toggle, delete confirmation, permission gating) is identical everywhere
 * and lives in one place.
 */

const statusField: CmsField = {
  name: "status",
  label: "Status",
  kind: "select",
  options: WEB_CONTENT_STATUSES.map((value) => ({
    value,
    label: WEB_CONTENT_STATUS_LABELS[value],
  })),
};
const orderField: CmsField = {
  name: "displayOrder",
  label: "Display order",
  kind: "number",
};
const seoFields: CmsField[] = [
  { name: "metaTitle", label: "Meta title", kind: "text" },
  { name: "metaDescription", label: "Meta description", kind: "text" },
];

export function PagesTab() {
  return (
    <CmsCrud<CmsPage>
      entity="Page"
      queryKey="pages"
      managePermission="website.page.manage"
      list={websiteApi.listPages}
      create={websiteApi.createPage}
      update={websiteApi.updatePage}
      remove={websiteApi.deletePage}
      publish={websiteApi.publishPage}
      emptyTitle="No pages yet"
      emptyDescription="Add the About, History and Mission pages the site navigation links to."
      defaults={{
        title: "",
        slug: "",
        content: "",
        template: "DEFAULT",
        status: "DRAFT",
        showInMenu: false,
        displayOrder: 0,
      }}
      toForm={(row) => ({
        title: row.title,
        titleBn: row.titleBn ?? "",
        slug: row.slug,
        content: row.content,
        contentBn: row.contentBn ?? "",
        excerpt: row.excerpt ?? "",
        metaTitle: row.metaTitle ?? "",
        metaDescription: row.metaDescription ?? "",
        ogImageUrl: row.ogImageUrl ?? "",
        template: row.template,
        showInMenu: row.showInMenu,
        displayOrder: row.displayOrder,
        status: row.status,
      })}
      fields={[
        { name: "title", label: "Title", kind: "text" },
        { name: "titleBn", label: "Title (Bangla)", kind: "text" },
        {
          name: "slug",
          label: "URL slug",
          kind: "text",
          placeholder: "principal-message",
          help: "Leave blank to derive it from the title. Kebab-case; reserved words are refused.",
        },
        {
          name: "template",
          label: "Template",
          kind: "select",
          options: CMS_TEMPLATES.map((value) => ({ value, label: value })),
        },
        {
          name: "content",
          label: "Content (HTML)",
          kind: "html",
          help: "Markup is sanitized on save — scripts, styles and event handlers are stripped.",
        },
        { name: "contentBn", label: "Content — Bangla (HTML)", kind: "html" },
        { name: "excerpt", label: "Excerpt", kind: "textarea" },
        ...seoFields,
        { name: "ogImageUrl", label: "Share image URL", kind: "text" },
        { name: "showInMenu", label: "Show in the site menu", kind: "checkbox" },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Title", render: (row) => row.title },
        {
          header: "URL",
          render: (row) => (
            <code className="text-xs text-muted-foreground">/{row.slug}</code>
          ),
        },
        {
          header: "Menu",
          render: (row) => (row.showInMenu ? "Yes" : "—"),
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function NewsTab() {
  return (
    <CmsCrud<NewsPost>
      entity="Post"
      queryKey="news"
      managePermission="website.news.manage"
      list={websiteApi.listNews}
      create={websiteApi.createNews}
      update={websiteApi.updateNews}
      remove={websiteApi.deleteNews}
      publish={websiteApi.publishNews}
      emptyTitle="No posts yet"
      emptyDescription="Publish news, a blog post or an achievement."
      defaults={{
        title: "",
        slug: "",
        content: "",
        category: "NEWS",
        status: "DRAFT",
      }}
      toForm={(row) => ({
        title: row.title,
        titleBn: row.titleBn ?? "",
        slug: row.slug,
        excerpt: row.excerpt ?? "",
        content: row.content,
        contentBn: row.contentBn ?? "",
        coverUrl: row.coverUrl ?? "",
        category: row.category,
        metaTitle: row.metaTitle ?? "",
        metaDescription: row.metaDescription ?? "",
        status: row.status,
      })}
      fields={[
        { name: "title", label: "Title", kind: "text" },
        { name: "titleBn", label: "Title (Bangla)", kind: "text" },
        { name: "slug", label: "URL slug", kind: "text" },
        {
          name: "category",
          label: "Category",
          kind: "select",
          options: NEWS_CATEGORIES.map((value) => ({
            value,
            label: NEWS_CATEGORY_LABELS[value],
          })),
        },
        { name: "coverUrl", label: "Cover image URL", kind: "text" },
        { name: "excerpt", label: "Excerpt", kind: "textarea" },
        { name: "content", label: "Body (HTML)", kind: "html" },
        { name: "contentBn", label: "Body — Bangla (HTML)", kind: "html" },
        ...seoFields,
        statusField,
      ]}
      columns={[
        { header: "Title", render: (row) => row.title },
        {
          header: "Category",
          render: (row) => (
            <Badge variant="outline">{NEWS_CATEGORY_LABELS[row.category]}</Badge>
          ),
        },
        {
          header: "URL",
          render: (row) => (
            <code className="text-xs text-muted-foreground">
              /news/{row.slug}
            </code>
          ),
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function GalleriesTab() {
  return (
    <CmsCrud<Gallery>
      entity="Album"
      queryKey="galleries"
      managePermission="website.gallery.manage"
      list={websiteApi.listGalleries}
      create={websiteApi.createGallery}
      update={websiteApi.updateGallery}
      remove={websiteApi.deleteGallery}
      publish={websiteApi.publishGallery}
      emptyTitle="No albums yet"
      emptyDescription="Create an album and add photos or video links."
      defaults={{ title: "", status: "DRAFT", displayOrder: 0, items: [] }}
      toForm={(row) => ({
        title: row.title,
        titleBn: row.titleBn ?? "",
        description: row.description ?? "",
        eventDate: row.eventDate?.slice(0, 10) ?? "",
        coverUrl: row.coverUrl ?? "",
        status: row.status,
        displayOrder: row.displayOrder,
        items: row.items ?? [],
      })}
      fields={[
        { name: "title", label: "Title", kind: "text" },
        { name: "titleBn", label: "Title (Bangla)", kind: "text" },
        { name: "eventDate", label: "Event date", kind: "date" },
        { name: "coverUrl", label: "Cover image URL", kind: "text" },
        { name: "description", label: "Description", kind: "textarea" },
        {
          name: "items",
          label: "Items",
          kind: "gallery-items",
          help: "Saving replaces the album's items with this list.",
        },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Album", render: (row) => row.title },
        {
          header: "Event date",
          render: (row) => row.eventDate?.slice(0, 10) ?? "—",
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function CareersTab() {
  return (
    <CmsCrud<Career>
      entity="Opening"
      queryKey="careers"
      managePermission="website.career.manage"
      list={websiteApi.listCareers}
      create={websiteApi.createCareer}
      update={websiteApi.updateCareer}
      remove={websiteApi.deleteCareer}
      emptyTitle="No openings"
      emptyDescription="Post a vacancy and collect applications with CVs."
      defaults={{ title: "", description: "", status: "DRAFT", displayOrder: 0 }}
      toForm={(row) => ({
        title: row.title,
        description: row.description,
        location: row.location ?? "",
        vacancies: row.vacancies ?? "",
        deadline: row.deadline?.slice(0, 10) ?? "",
        status: row.status,
        displayOrder: row.displayOrder,
      })}
      fields={[
        { name: "title", label: "Position", kind: "text" },
        { name: "location", label: "Location", kind: "text" },
        { name: "vacancies", label: "Vacancies", kind: "number" },
        { name: "deadline", label: "Apply by", kind: "date" },
        { name: "description", label: "Description (HTML)", kind: "html" },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Position", render: (row) => row.title },
        { header: "Location", render: (row) => row.location ?? "—" },
        {
          header: "Deadline",
          render: (row) => row.deadline?.slice(0, 10) ?? "—",
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function FaqsTab() {
  return (
    <CmsCrud<Faq>
      entity="Question"
      queryKey="faqs"
      managePermission="website.faq.manage"
      list={websiteApi.listFaqs}
      create={websiteApi.createFaq}
      update={websiteApi.updateFaq}
      remove={websiteApi.deleteFaq}
      emptyTitle="No questions yet"
      emptyDescription="Answer what parents ask most often."
      defaults={{
        question: "",
        answer: "",
        status: "PUBLISHED",
        displayOrder: 0,
      }}
      toForm={(row) => ({
        question: row.question,
        questionBn: row.questionBn ?? "",
        answer: row.answer,
        answerBn: row.answerBn ?? "",
        category: row.category ?? "",
        status: row.status,
        displayOrder: row.displayOrder,
      })}
      fields={[
        { name: "question", label: "Question", kind: "text", full: true },
        { name: "questionBn", label: "Question (Bangla)", kind: "text", full: true },
        { name: "answer", label: "Answer (HTML)", kind: "html", rows: 6 },
        { name: "answerBn", label: "Answer — Bangla (HTML)", kind: "html", rows: 6 },
        { name: "category", label: "Category", kind: "text" },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Question", render: (row) => row.question },
        { header: "Category", render: (row) => row.category ?? "—" },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function CommitteeTab() {
  return (
    <CmsCrud<CommitteeMember>
      entity="Member"
      queryKey="committee"
      managePermission="website.committee.manage"
      list={websiteApi.listCommittee}
      create={websiteApi.createMember}
      update={websiteApi.updateMember}
      remove={websiteApi.deleteMember}
      emptyTitle="No committee members"
      emptyDescription="Add the governing body — a member with a message gets a full block on the site."
      defaults={{
        name: "",
        designation: "",
        status: "PUBLISHED",
        displayOrder: 0,
      }}
      toForm={(row) => ({
        name: row.name,
        nameBn: row.nameBn ?? "",
        designation: row.designation,
        photoUrl: row.photoUrl ?? "",
        message: row.message ?? "",
        status: row.status,
        displayOrder: row.displayOrder,
      })}
      fields={[
        { name: "name", label: "Name", kind: "text" },
        { name: "nameBn", label: "Name (Bangla)", kind: "text" },
        { name: "designation", label: "Designation", kind: "text" },
        { name: "photoUrl", label: "Photo URL", kind: "text" },
        {
          name: "message",
          label: "Message (HTML)",
          kind: "html",
          rows: 8,
          help: "A member with a message gets their own block on /committee.",
        },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Name", render: (row) => row.name },
        { header: "Designation", render: (row) => row.designation },
        {
          header: "Message",
          render: (row) => (row.message ? "Yes" : "—"),
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}

export function DownloadsTabTable() {
  return (
    <CmsCrud<DownloadFile>
      entity="File"
      queryKey="downloads"
      managePermission="website.download.manage"
      list={websiteApi.listDownloads}
      create={websiteApi.createDownload}
      update={websiteApi.updateDownload}
      remove={websiteApi.deleteDownload}
      emptyTitle="No files yet"
      emptyDescription="Publish forms, syllabuses and routines."
      defaults={{
        title: "",
        fileUrl: "",
        status: "DRAFT",
        displayOrder: 0,
      }}
      toForm={(row) => ({
        title: row.title,
        titleBn: row.titleBn ?? "",
        category: row.category ?? "",
        fileUrl: row.fileUrl,
        fileKey: row.fileKey ?? "",
        sizeBytes: row.sizeBytes ?? "",
        status: row.status,
        displayOrder: row.displayOrder,
      })}
      fields={[
        { name: "title", label: "Title", kind: "text" },
        { name: "titleBn", label: "Title (Bangla)", kind: "text" },
        { name: "category", label: "Category", kind: "text" },
        {
          name: "fileUrl",
          label: "File URL",
          kind: "text",
          full: true,
          help: "Use the upload button above to add a file, or paste a link.",
        },
        orderField,
        statusField,
      ]}
      columns={[
        { header: "Title", render: (row) => row.title },
        { header: "Category", render: (row) => row.category ?? "—" },
        {
          header: "Downloads",
          render: (row) => (
            <span className="tabular-nums">{row.downloadCount}</span>
          ),
        },
        { header: "Status", render: (row) => <StatusBadge status={row.status} /> },
      ]}
    />
  );
}
