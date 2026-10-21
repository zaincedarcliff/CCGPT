// Rendering of assistant/user message text with inline citations and a clickable source list.
// Everything is built as React nodes (no dangerouslySetInnerHTML), so model output can't inject HTML.

const SAFE_URL_RE = /^https?:\/\//i

/**
 * Inline renderer: **bold**, [n] citation markers (→ clickable superscript links to the matching
 * source), [label](url) markdown links, and bare URLs.
 * @param {string} line
 * @param {Map<number, object>} sourcesByN
 */
function renderInline(line, sourcesByN, keyPrefix) {
  const tokenRe = /(\*\*(.+?)\*\*)|(\[(\d{1,2})\])|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g
  const parts = []
  let last = 0
  let m
  let k = 0
  while ((m = tokenRe.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    const key = `${keyPrefix}-${k++}`
    if (m[1]) {
      parts.push(<strong key={key}>{m[2]}</strong>)
    } else if (m[3]) {
      const n = Number(m[4])
      const src = sourcesByN.get(n)
      if (src && SAFE_URL_RE.test(src.url)) {
        parts.push(
          <a
            key={key}
            className="cite"
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${src.title} — ${src.publisher}`}
          >
            {n}
          </a>,
        )
      } else {
        parts.push(m[3])
      }
    } else if (m[5]) {
      parts.push(
        <a key={key} href={m[7]} target="_blank" rel="noopener noreferrer">
          {m[6]}
        </a>,
      )
    } else if (m[8]) {
      parts.push(
        <a key={key} href={m[8]} target="_blank" rel="noopener noreferrer">
          {m[8].replace(/^https?:\/\/(www\.)?/, '')}
        </a>,
      )
    }
    last = tokenRe.lastIndex
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts.length ? parts : line
}

/**
 * Message body: bold, bullets, links, and [n] markers wired to `sources`.
 * @param {{ text: string, sources?: object[] }} props sources = list returned by /api/chat (numbered to match [n])
 */
export function MessageText({ text, sources = [] }) {
  const sourcesByN = new Map((sources || []).map((s) => [s.n, s]))
  const lines = String(text || '').split('\n')
  return lines.map((rawLine, i) => {
    const bullet = /^\s*[-*•]\s+/.test(rawLine)
    const line = bullet ? rawLine.replace(/^\s*[-*•]\s+/, '') : rawLine
    const content = renderInline(line, sourcesByN, i)
    return (
      <span key={i} className={bullet ? 'msg-line msg-line--bullet' : 'msg-line'}>
        {bullet && (
          <span className="msg-bullet" aria-hidden="true">
            •
          </span>
        )}
        {content}
        {i < lines.length - 1 && <br />}
      </span>
    )
  })
}

/** Clickable source list rendered under an assistant reply. */
export function MessageSources({ sources }) {
  if (!sources?.length) return null
  const cited = sources.filter((s) => s.cited)
  const consulted = sources.filter((s) => !s.cited)
  const render = (s) => {
    const when = s.lastChanged || s.publishedAt || s.lastChecked
    return (
      <li key={`${s.n}-${s.url}`} className="msg-source">
        <span className="msg-source__n">{s.n}</span>
        <a className="msg-source__link" href={s.url} target="_blank" rel="noopener noreferrer">
          {s.title}
        </a>
        <span className="msg-source__meta">
          {s.publisher}
          {s.tier === 1 && <span className="msg-source__badge msg-source__badge--official">Official</span>}
          {s.origin === 'live' && <span className="msg-source__badge">Live</span>}
          {s.tier === 2 && <span className="msg-source__badge">Trusted</span>}
          {s.tier >= 3 && <span className="msg-source__badge msg-source__badge--third">Third-party</span>}
          {s.docYear && <span className="msg-source__year">{s.docYear}</span>}
          {when && (
            <span className="msg-source__date">
              {s.lastChanged ? 'updated' : s.publishedAt ? 'published' : 'checked'} {String(when).slice(0, 10)}
            </span>
          )}
        </span>
      </li>
    )
  }
  return (
    <div className="msg-sources">
      {cited.length > 0 && (
        <>
          <p className="msg-sources__title">Sources</p>
          <ol className="msg-sources__list">{cited.map(render)}</ol>
        </>
      )}
      {consulted.length > 0 && (
        <>
          <p className="msg-sources__title">Sources consulted</p>
          <ol className="msg-sources__list">{consulted.map(render)}</ol>
        </>
      )}
    </div>
  )
}
