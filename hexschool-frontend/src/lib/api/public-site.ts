import { API_BASE_URL } from "./axios";

/**
 * Server-side reader for the public website (Module 19).
 *
 * Deliberately native `fetch`, not the shared axios client: these calls
 * run in React Server Components, and `fetch` is what Next.js
 * instruments for ISR (`next: { revalidate }`). Axios would bypass the
 * data cache entirely and make every page dynamic — which is the opposite
 * of what a school's brochure site needs on result day (roadmap §8).
 *
 * The API's envelope is unwrapped here so pages read plain data, and a
 * 404 becomes `null` so a page can call `notFound()` itself.
 */

/** Roadmap §5: ISR, revalidate 60 s for content pages. */
export const SITE_REVALIDATE = 60;

export interface SiteConfig {
  school: {
    name: string;
    nameBn: string | null;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    eiin: string | null;
    establishedYear: number | null;
  } | null;
  site: {
    title: string;
    titleBn: string;
    tagline: string;
    metaDescription: string;
    ogImageUrl: string;
    footerText: string;
    social: { facebook: string; youtube: string; linkedin: string; x: string };
    mapEmbedUrl: string;
    quickLinks: Array<{ label?: string; href?: string }>;
    analyticsId: string;
    defaultLanguage: string;
    languageToggle: boolean;
    siteUrl: string;
  };
  features: {
    teacherDirectory: boolean;
    studentVerification: boolean;
    certificateVerification: boolean;
  };
  menu: Array<{ slug: string; title: string; titleBn: string | null }>;
}

export interface NoticeCard {
  id: string;
  title: string;
  body: string;
  attachmentUrls: string[];
  pinned: boolean;
  publishedAt: string;
}

export interface NewsCard {
  slug: string;
  title: string;
  titleBn: string | null;
  excerpt: string | null;
  coverUrl: string | null;
  category: "NEWS" | "BLOG" | "ACHIEVEMENT";
  publishedAt: string | null;
}

export interface EventCard {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startDate: string;
  endDate: string;
}

export interface GalleryCard {
  id: string;
  title: string;
  titleBn?: string | null;
  description?: string | null;
  eventDate: string | null;
  coverUrl: string | null;
  itemCount?: number;
}

export interface HomePayload {
  hero: {
    slides: Array<{
      imageUrl?: string;
      title?: string;
      subtitle?: string;
      ctaLabel?: string;
      ctaHref?: string;
    }>;
  };
  stats: {
    students: number;
    teachers: number;
    staff: number;
    classes: number;
  };
  notices: NoticeCard[];
  news: NewsCard[];
  achievements: NewsCard[];
  events: EventCard[];
  galleries: GalleryCard[];
  principalMessage: {
    name: string;
    designation: string;
    photoUrl: string | null;
    teaser: string;
  } | null;
}

export interface CmsPagePayload {
  slug: string;
  title: string;
  titleBn: string | null;
  content: string;
  contentBn: string | null;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  template: "DEFAULT" | "LANDING" | "CONTACT";
  publishedAt: string | null;
  updatedAt: string;
  isDraft: boolean;
}

export interface NewsPostPayload extends NewsCard {
  content: string;
  contentBn: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  isDraft: boolean;
}

export interface FeedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TeacherCard {
  id: string;
  name: string;
  designation: string;
  specialization: string | null;
  photoUrl: string | null;
  since: string;
  qualifications: string[];
  subjects: string[];
}

export interface CommitteeCard {
  id: string;
  name: string;
  nameBn: string | null;
  designation: string;
  photoUrl: string | null;
  message: string | null;
}

export interface DownloadCard {
  id: string;
  title: string;
  titleBn: string | null;
  category: string | null;
  fileUrl: string;
  sizeBytes: number | null;
  downloadCount: number;
}

export interface CareerCard {
  id: string;
  title: string;
  description: string;
  location: string | null;
  vacancies: number | null;
  deadline: string | null;
}

export interface FaqCard {
  id: string;
  question: string;
  questionBn: string | null;
  answer: string;
  answerBn: string | null;
  category: string | null;
}

async function getPublic<T>(
  path: string,
  options: { revalidate?: number } = {},
): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/public${path}`, {
      next: { revalidate: options.revalidate ?? SITE_REVALIDATE },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: T };
    return body.data;
  } catch {
    // The API being down must not crash a cached marketing page; the
    // caller renders its empty state (roadmap §8).
    return null;
  }
}

export const publicSite = {
  config: () => getPublic<SiteConfig>("/config"),
  home: () => getPublic<HomePayload>("/home"),

  page: (slug: string, preview?: string) =>
    getPublic<CmsPagePayload>(
      `/pages/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`,
      // A previewed draft must never be cached — it is one editor's view.
      preview ? { revalidate: 0 } : {},
    ),

  news: (params: { page?: number; category?: string; search?: string } = {}) =>
    getPublic<{ items: NewsCard[]; meta: FeedMeta }>(
      `/news${query(params)}`,
    ),
  newsPost: (slug: string, preview?: string) =>
    getPublic<NewsPostPayload>(
      `/news/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`,
      preview ? { revalidate: 0 } : {},
    ),

  notices: (params: { page?: number; search?: string } = {}) =>
    getPublic<{ items: NoticeCard[]; meta: FeedMeta }>(
      `/notices${query(params)}`,
    ),
  notice: (id: string) => getPublic<NoticeCard>(`/notices/${id}`),

  events: () => getPublic<EventCard[]>("/events"),
  galleries: () => getPublic<GalleryCard[]>("/galleries"),
  gallery: (id: string, page = 1) =>
    getPublic<
      GalleryCard & {
        items: Array<{
          id: string;
          type: "IMAGE" | "VIDEO_URL";
          url: string;
          caption: string | null;
        }>;
        meta: FeedMeta;
      }
    >(`/galleries/${id}${query({ page })}`),

  teachers: () => getPublic<TeacherCard[]>("/teachers"),
  committee: () => getPublic<CommitteeCard[]>("/committee"),
  downloads: () => getPublic<DownloadCard[]>("/downloads"),
  careers: () => getPublic<CareerCard[]>("/careers"),
  faqs: () => getPublic<FaqCard[]>("/faqs"),

  sitemapUrls: () =>
    getPublic<Array<{ path: string; lastModified: string | null; priority: number }>>(
      "/sitemap-urls",
    ),
};

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
