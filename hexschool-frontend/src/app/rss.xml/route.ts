import { API_BASE_URL } from "@/lib/api/axios";

/**
 * `/rss.xml` — the news feed. The API already renders valid RSS 2.0 from
 * its `buildRss` engine, so this route proxies it rather than rebuilding
 * the XML in a second place; the school's site URL is the one thing the
 * feed needs and that lives in `website.site_url`.
 */
export const revalidate = 600;

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${API_BASE_URL}/public/rss.xml`, {
      next: { revalidate },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.ok ? 200 : 503,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    });
  } catch {
    return new Response("", {
      status: 503,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    });
  }
}
