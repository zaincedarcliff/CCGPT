import { put } from "@vercel/blob";
import { runScrape } from "../index.js";

export const config = {
  maxDuration: 300,
};

export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const data = await runScrape();
    const body = JSON.stringify({
      updatedAt: new Date().toISOString(),
      count: data.length,
      data,
    });

    const blob = await put("schoolData.json", body, {
      access: "public",
      contentType: "application/json",
      allowOverwrite: true,
      addRandomSuffix: false,
    });

    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      count: data.length,
      url: blob.url,
    });
  } catch (err) {
    console.error("Scrape failed:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
