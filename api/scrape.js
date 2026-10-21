// Daily cron (see vercel.json): incremental crawl + re-index of official school sources.
//
// - Only pages that are *due* are fetched; unchanged content (same hash) is not re-embedded.
// - Runs inside a time budget and persists whatever it finished; leftovers carry to the next run.
// - Also writes the legacy `schoolData.json` blob so /api/data and the offline responder keep working.
//
// Trigger manually:  curl -X POST https://<app>/api/scrape -H "Authorization: Bearer $CRON_SECRET"
// Optional query:    ?budget=240000 (ms)  ?url=<single url to refresh>

import { put } from '@vercel/blob'
import { runCrawl, toLegacySchoolData } from '../lib/crawler.js'

export const config = {
  maxDuration: 300,
}

export default async function handler(req, res) {
  const auth = req.headers['authorization']
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const budgetMs = Math.min(280_000, Math.max(30_000, Number(req.query?.budget) || Number(process.env.KB_RUN_BUDGET_MS) || 240_000))
  const onlyUrls = req.query?.url ? [String(req.query.url)] : undefined

  try {
    const { index, summary } = await runCrawl({ budgetMs, onlyUrls, log: (...a) => console.log(...a) })

    let legacyUrl = null
    try {
      const data = toLegacySchoolData(index)
      const blob = await put('schoolData.json', JSON.stringify({ updatedAt: new Date().toISOString(), count: data.length, data }), {
        access: 'private',
        contentType: 'application/json',
        allowOverwrite: true,
        addRandomSuffix: false,
      })
      legacyUrl = blob.url
    } catch (err) {
      console.warn('legacy schoolData.json write failed:', err?.message || err)
    }

    return res.status(200).json({ ok: true, updatedAt: index.updatedAt, ...summary, legacyUrl })
  } catch (err) {
    console.error('Crawl failed:', err)
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
}
