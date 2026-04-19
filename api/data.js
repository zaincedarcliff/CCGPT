import { list } from "@vercel/blob";

export default async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: "schoolData.json", limit: 1 });
    if (blobs && blobs.length > 0) {
      const blob = blobs[0];
      const r = await fetch(blob.url, { cache: "no-store" });
      if (r.ok) {
        const json = await r.json();
        res.setHeader(
          "Cache-Control",
          "public, s-maxage=600, stale-while-revalidate=86400"
        );
        return res.status(200).json(json);
      }
    }
  } catch (err) {
    console.warn("Blob fetch failed, falling back to bundled data:", err?.message);
  }

  try {
    const fallback = await fetch(
      `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""}/schoolData.json`
    );
    if (fallback.ok) {
      const json = await fallback.json();
      return res.status(200).json({
        updatedAt: null,
        count: Array.isArray(json) ? json.length : 0,
        data: Array.isArray(json) ? json : [],
        fallback: true,
      });
    }
  } catch {
    // ignore
  }

  return res.status(200).json({ updatedAt: null, count: 0, data: [], fallback: true });
}
