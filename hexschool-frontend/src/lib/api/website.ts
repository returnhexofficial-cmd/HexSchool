import { api, ApiEnvelope, PaginationMeta } from "./axios";

/**
 * Mirrors the backend Website CMS API (Module 19): the admin CRUD surface
 * under `/cms/*` and the handful of PUBLIC writes the site performs from
 * the browser (contact form, career application, student verification,
 * download counter).
 *
 * Public *reads* are not here — they run server-side through
 * `lib/api/public-site.ts` so the site can be statically regenerated.
 */

// ── enums (kept in step with prisma/schema.prisma) ──────────────────────

export type WebContentStatus = "DRAFT" | "PUBLISHED";
export type CmsPageTemplate = "DEFAULT" | "LANDING" | "CONTACT";
export type NewsCategory = "NEWS" | "BLOG" | "ACHIEVEMENT";
export type GalleryItemType = "IMAGE" | "VIDEO_URL";
export type ContactMessageStatus = "NEW" | "READ" | "REPLIED";
export type CareerApplicationStatus = "RECEIVED" | "SHORTLISTED" | "REJECTED";

// ── types ───────────────────────────────────────────────────────────────

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  titleBn: string | null;
  content: string;
  contentBn: string | null;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  status: WebContentStatus;
  template: CmsPageTemplate;
  showInMenu: boolean;
  displayOrder: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface NewsPost {
  id: string;
  slug: string;
  title: string;
  titleBn: string | null;
  excerpt: string | null;
  content: string;
  contentBn: string | null;
  coverUrl: string | null;
  category: NewsCategory;
  metaTitle: string | null;
  metaDescription: string | null;
  status: WebContentStatus;
  publishedAt: string | null;
}

export interface GalleryItem {
  id?: string;
  type: GalleryItemType;
  url: string;
  caption: string | null;
  displayOrder: number;
}

export interface Gallery {
  id: string;
  title: string;
  titleBn: string | null;
  description: string | null;
  eventDate: string | null;
  coverUrl: string | null;
  status: WebContentStatus;
  displayOrder: number;
  items?: GalleryItem[];
}

export interface DownloadFile {
  id: string;
  title: string;
  titleBn: string | null;
  category: string | null;
  fileUrl: string;
  fileKey: string | null;
  sizeBytes: number | null;
  downloadCount: number;
  status: WebContentStatus;
  displayOrder: number;
}

export interface Career {
  id: string;
  title: string;
  description: string;
  location: string | null;
  vacancies: number | null;
  deadline: string | null;
  status: WebContentStatus;
  displayOrder: number;
}

export interface CareerApplication {
  id: string;
  careerId: string;
  name: string;
  phone: string;
  email: string | null;
  cvUrl: string;
  note: string | null;
  status: CareerApplicationStatus;
  createdAt: string;
}

export interface Faq {
  id: string;
  question: string;
  questionBn: string | null;
  answer: string;
  answerBn: string | null;
  category: string | null;
  status: WebContentStatus;
  displayOrder: number;
}

export interface CommitteeMember {
  id: string;
  name: string;
  nameBn: string | null;
  designation: string;
  photoUrl: string | null;
  message: string | null;
  status: WebContentStatus;
  displayOrder: number;
}

export interface ContactMessage {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  body: string;
  status: ContactMessageStatus;
  replyNote: string | null;
  readAt: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  [key: string]: string | number | undefined;
}

export interface Paged<T> {
  items: T[];
  meta: PaginationMeta;
}

async function paged<T>(path: string, params?: ListParams): Promise<Paged<T>> {
  const res = await api.get<ApiEnvelope<T[]>>(path, { params });
  return {
    items: res.data.data,
    meta: res.data.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}

const unwrap = <T>(res: { data: ApiEnvelope<T> }): T => res.data.data;

// ── admin CMS ───────────────────────────────────────────────────────────

export const websiteApi = {
  // pages
  listPages: (params?: ListParams) => paged<CmsPage>("/cms/pages", params),
  getPage: (id: string) =>
    api.get<ApiEnvelope<CmsPage>>(`/cms/pages/${id}`).then(unwrap),
  createPage: (input: Partial<CmsPage>) =>
    api.post<ApiEnvelope<CmsPage>>("/cms/pages", input).then(unwrap),
  updatePage: (id: string, input: Partial<CmsPage>) =>
    api.put<ApiEnvelope<CmsPage>>(`/cms/pages/${id}`, input).then(unwrap),
  publishPage: (id: string, publish: boolean) =>
    api
      .put<ApiEnvelope<CmsPage>>(`/cms/pages/${id}/publish`, { publish })
      .then(unwrap),
  deletePage: (id: string) => api.delete(`/cms/pages/${id}`).then(() => undefined),

  // news
  listNews: (params?: ListParams) => paged<NewsPost>("/cms/news", params),
  createNews: (input: Partial<NewsPost>) =>
    api.post<ApiEnvelope<NewsPost>>("/cms/news", input).then(unwrap),
  updateNews: (id: string, input: Partial<NewsPost>) =>
    api.put<ApiEnvelope<NewsPost>>(`/cms/news/${id}`, input).then(unwrap),
  publishNews: (id: string, publish: boolean) =>
    api
      .put<ApiEnvelope<NewsPost>>(`/cms/news/${id}/publish`, { publish })
      .then(unwrap),
  deleteNews: (id: string) => api.delete(`/cms/news/${id}`).then(() => undefined),

  // galleries
  listGalleries: (params?: ListParams) =>
    paged<Gallery>("/cms/galleries", params),
  getGallery: (id: string) =>
    api.get<ApiEnvelope<Gallery>>(`/cms/galleries/${id}`).then(unwrap),
  createGallery: (input: Partial<Gallery>) =>
    api.post<ApiEnvelope<Gallery>>("/cms/galleries", input).then(unwrap),
  updateGallery: (id: string, input: Partial<Gallery>) =>
    api.put<ApiEnvelope<Gallery>>(`/cms/galleries/${id}`, input).then(unwrap),
  publishGallery: (id: string, publish: boolean) =>
    api
      .put<ApiEnvelope<Gallery>>(`/cms/galleries/${id}/publish`, { publish })
      .then(unwrap),
  deleteGallery: (id: string) =>
    api.delete(`/cms/galleries/${id}`).then(() => undefined),

  // downloads
  listDownloads: (params?: ListParams) =>
    paged<DownloadFile>("/cms/downloads", params),
  uploadDownload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<
        ApiEnvelope<{ fileUrl: string; fileKey: string; sizeBytes: number }>
      >("/cms/downloads/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then(unwrap);
  },
  createDownload: (input: Partial<DownloadFile>) =>
    api.post<ApiEnvelope<DownloadFile>>("/cms/downloads", input).then(unwrap),
  updateDownload: (id: string, input: Partial<DownloadFile>) =>
    api
      .put<ApiEnvelope<DownloadFile>>(`/cms/downloads/${id}`, input)
      .then(unwrap),
  deleteDownload: (id: string) =>
    api.delete(`/cms/downloads/${id}`).then(() => undefined),

  // careers
  listCareers: (params?: ListParams) => paged<Career>("/cms/careers", params),
  createCareer: (input: Partial<Career>) =>
    api.post<ApiEnvelope<Career>>("/cms/careers", input).then(unwrap),
  updateCareer: (id: string, input: Partial<Career>) =>
    api.put<ApiEnvelope<Career>>(`/cms/careers/${id}`, input).then(unwrap),
  deleteCareer: (id: string) =>
    api.delete(`/cms/careers/${id}`).then(() => undefined),
  listApplications: (careerId: string, params?: ListParams) =>
    paged<CareerApplication>(`/cms/careers/${careerId}/applications`, params),
  updateApplication: (
    id: string,
    input: { status: CareerApplicationStatus; note?: string },
  ) =>
    api
      .put<ApiEnvelope<CareerApplication>>(
        `/cms/career-applications/${id}`,
        input,
      )
      .then(unwrap),

  // FAQs
  listFaqs: (params?: ListParams) => paged<Faq>("/cms/faqs", params),
  createFaq: (input: Partial<Faq>) =>
    api.post<ApiEnvelope<Faq>>("/cms/faqs", input).then(unwrap),
  updateFaq: (id: string, input: Partial<Faq>) =>
    api.put<ApiEnvelope<Faq>>(`/cms/faqs/${id}`, input).then(unwrap),
  deleteFaq: (id: string) => api.delete(`/cms/faqs/${id}`).then(() => undefined),

  // committee
  listCommittee: (params?: ListParams) =>
    paged<CommitteeMember>("/cms/committee", params),
  createMember: (input: Partial<CommitteeMember>) =>
    api.post<ApiEnvelope<CommitteeMember>>("/cms/committee", input).then(unwrap),
  updateMember: (id: string, input: Partial<CommitteeMember>) =>
    api
      .put<ApiEnvelope<CommitteeMember>>(`/cms/committee/${id}`, input)
      .then(unwrap),
  deleteMember: (id: string) =>
    api.delete(`/cms/committee/${id}`).then(() => undefined),

  // contact inbox
  listMessages: (params?: ListParams) =>
    paged<ContactMessage>("/cms/contact-messages", params),
  setMessageStatus: (
    id: string,
    input: { status: ContactMessageStatus; replyNote?: string },
  ) =>
    api
      .put<ApiEnvelope<ContactMessage>>(
        `/cms/contact-messages/${id}/status`,
        input,
      )
      .then(unwrap),
  deleteMessage: (id: string) =>
    api.delete(`/cms/contact-messages/${id}`).then(() => undefined),

  // draft preview
  previewToken: (type: "page" | "news", id: string) =>
    api
      .post<ApiEnvelope<{ token: string; expiresIn: string }>>(
        "/cms/preview-token",
        { type, id },
      )
      .then(unwrap),
};

// ── public writes (from the browser) ────────────────────────────────────

export interface StudentVerificationResult {
  verified: true;
  studentUid: string;
  name?: string;
  status?: string;
  photoUrl?: string | null;
  class?: string;
  section?: string;
  roll?: number;
  session?: string;
}

export const publicSiteApi = {
  contact: (input: {
    name: string;
    phone?: string;
    email?: string;
    subject?: string;
    body: string;
    recaptchaToken?: string;
  }) =>
    api
      .post<ApiEnvelope<{ message: string }>>("/public/contact", input)
      .then(unwrap),

  applyToCareer: (
    careerId: string,
    input: { name: string; phone: string; email?: string; note?: string },
    cv: File,
  ) => {
    const form = new FormData();
    form.append("file", cv);
    for (const [key, value] of Object.entries(input)) {
      if (value) form.append(key, value);
    }
    return api
      .post<
        ApiEnvelope<{ id: string; message: string }>
      >(`/public/careers/${careerId}/apply`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then(unwrap);
  },

  verifyStudent: (identifier: string, recaptchaToken?: string) =>
    api
      .post<ApiEnvelope<StudentVerificationResult>>("/public/verify/student", {
        identifier,
        recaptchaToken,
      })
      .then(unwrap),

  verifyCertificate: (code: string) =>
    api
      .get<ApiEnvelope<{ available: boolean; code: string; reason: string }>>(
        "/public/verify/certificate",
        { params: { code } },
      )
      .then(unwrap),

  /** Counts the click and hands back the URL to open. */
  registerDownload: (id: string) =>
    api
      .post<ApiEnvelope<{ fileUrl: string; downloadCount: number }>>(
        `/public/downloads/${id}/hit`,
      )
      .then(unwrap),
};
