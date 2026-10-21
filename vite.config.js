import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Dev-only plugin: serves the Vercel serverless functions in `api/` from the Vite dev server so
 * `npm run dev` works end-to-end (/api/chat, /api/kb-status, …) without `vercel dev`.
 * Mimics the Vercel Node helpers the handlers rely on (req.query, req.body, res.status().json()).
 */
function localApiPlugin(env) {
  return {
    name: 'ccgpt-local-api',
    configureServer(server) {
      // Server-side env for the handlers (never exposed to the client bundle).
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://localhost')
        const name = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '')
        if (!/^[\w-]+$/.test(name)) return next()
        const file = path.resolve(process.cwd(), 'api', `${name}.js`)
        if (!fs.existsSync(file)) return next()

        // Vercel-style helpers
        req.query = Object.fromEntries(url.searchParams.entries())
        res.status = (code) => {
          res.statusCode = code
          return res
        }
        res.json = (obj) => {
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(obj))
          return res
        }
        res.send = (body) => {
          res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
          return res
        }
        if (/application\/json/i.test(String(req.headers['content-type'] || ''))) {
          req.body = await new Promise((resolve) => {
            let data = ''
            req.on('data', (c) => (data += c))
            req.on('end', () => {
              try {
                resolve(data ? JSON.parse(data) : {})
              } catch {
                resolve({})
              }
            })
            req.on('error', () => resolve({}))
          })
        }

        try {
          const mod = await server.ssrLoadModule(file)
          await mod.default(req, res)
        } catch (err) {
          console.error(`[local-api] /api/${name} failed:`, err)
          if (!res.headersSent) res.status(500).json({ error: String(err?.message || err) })
          else res.end()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), localApiPlugin(env)],
  }
})
