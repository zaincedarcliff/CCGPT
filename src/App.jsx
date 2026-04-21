import { useState, useRef, useEffect, useCallback } from 'react'
import cedarCliffLogo from './assets/cedar-cliff-logo.png'
import { askGemini, isGeminiConfigured, isHomeworkHelpRequest, HOMEWORK_REFUSAL_MESSAGE } from './gemini.js'
import {
  loadSchoolData,
  extractRelevantSnippets,
  detectNamedSport,
  extractLatestForSport,
  extractAPCourses,
  extractCourses,
  groupCoursesByDept,
  filterCourses,
  parseCourseQuery,
  isCourseListQuestion,
  COURSE_DEPARTMENTS,
} from './schoolData.js'
import { auth, logout, onAuthStateChanged, linkPasswordToCurrentUser } from './firebase.js'
import Auth from './Auth.jsx'
import './App.css'

const quickActions = [
  { label: 'School location', icon: '📍' },
  { label: 'My Counselor', icon: '👤' },
  { label: 'Sports', icon: '🏆' },
  { label: 'Principal', icon: '🎓' },
  { label: 'Basketball games', icon: '🏀' },
  { label: 'Contact info', icon: '📞' },
  { label: 'Clubs', icon: '🏫' },
  { label: 'Senior info', icon: '📃' },
]

const schoolKnowledge = {
  'school location': `Cedar Cliff High School is located at 1301 Carlisle Road, Camp Hill, PA 17011. It's part of the West Shore School District in Cumberland County, Pennsylvania.\n\nPhone: 717-737-8654 | Fax: 717-737-0874`,
  'my counselor': `Cedar Cliff High School counselors are assigned by graduating class:\n\n• **Class of 2029 (Freshmen)**: Ms. Meghan Cummings — mcummings@wssd.k12.pa.us, ext. 215\n• **Class of 2028 (Sophomores)**: Mrs. Jessie Alexander-Gray — jalexander@wssd.k12.pa.us, ext. 218\n• **Class of 2027 (Juniors)**: Mrs. Jennifer Crager — jcrager@wssd.k12.pa.us, ext. 219\n• **Class of 2026 (Seniors)**: Mr. Patrick Tierney — ptierney@wssd.k12.pa.us, ext. 220\n\n**Support**: Ms. Stacy Thorpe (GIEP, Life Skills, CTC, ELL) — sthorpe@wssd.k12.pa.us, ext. 217\n**Guidance Secretary**: Ms. Joyce Hayes — jhayes@wssd.k12.pa.us, ext. 221`,
  'sports': `Cedar Cliff offers a wide range of sports programs:\n\n🏈 **Fall**: Football, Boys & Girls Soccer, Field Hockey, Golf, Girls Volleyball, Girls Tennis, Cross Country, Cheerleading\n🏀 **Winter**: Boys & Girls Basketball, Boys & Girls Wrestling, Boys & Girls Swimming & Diving, Unified Bocce, Cheerleading\n⚾ **Spring**: Baseball, Softball, Boys & Girls Lacrosse, Boys Volleyball, Boys Tennis, Track & Field\n\nSome teams also have JV and Freshman squads. Go Colts! 🐴`,
  'principal': `The principal of Cedar Cliff High School is **Mrs. Jennifer S. Post**.\n\nShe became principal for the 2025-26 school year. She started at Cedar Cliff in 2000 as a Social Studies teacher and later served as assistant principal and principal at other district schools.\n\nHer focus is on ensuring students feel welcomed, safe, and supported.\n\nContact the main office at 717-737-8654.`,
  'basketball games': `Cedar Cliff Colts Basketball 🏀\n\nThe Colts compete in the Mid-Penn Conference.`,
  'contact info': `📞 **Cedar Cliff High School Contact Information**\n\n• **Main Office**: 717-737-8654\n• **Fax**: 717-737-0874\n• **Address**: 1301 Carlisle Road, Camp Hill, PA 17011\n• **District**: West Shore School District\n• **Website**: https://www.wssd.k12.pa.us/cedarcliff.aspx\n• **Instagram**: @cedarcliff_colts`,
  'clubs': `Cedar Cliff offers 50+ clubs and extracurricular activities:\n\n🎭 **Arts & Performance**: Drama Club, Band, Choir, Art Club, Musical\n📚 **Academic**: National Honor Society, Math League, Science Olympiad, Debate Team, Model UN\n🤝 **Service**: Key Club, Student Government, SADD, Interact Club, Friends Forever Club\n💻 **Technology**: Robotics Club, Coding Club\n🌍 **Cultural**: Spanish Club, French Club, Diversity Club\n🎖️ **Leadership**: JROTC (Honor Unit with Distinction)\n⚡ **Other**: Yearbook, School Newspaper, FBLA, DECA, Aquaponics\n\nClub meetings are typically held after school. Check the morning announcements for meeting times!`,
  'senior info': `🎓 **Senior Information (Class of 2026)**\n\n• **Graduation**: PA Farm Show Complex\n• **Cap & Gown**: $45 (cash/check)\n• **Senior Portraits**: Check yearbook info on the school website\n• **Senior Counselor**: Mr. Patrick Tierney — ptierney@wssd.k12.pa.us, ext. 220\n• **Key Events**: Prom, SAT dates, Senior Exit Interviews, Senior Awards Night, Graduation\n• **College Apps**: See your counselor for guidance and recommendation letters\n• **Transcripts**: Request through the guidance office\n\nCongratulations on your senior year, Colt! 🐴`,
}

const SPORT_WORDS = [
  'soccer', 'football', 'basketball', 'baseball', 'softball', 'volleyball', 'lacrosse',
  'tennis', 'golf', 'hockey', 'wrestling', 'swim', 'swimming', 'track', 'cheer', 'cheerleading',
  'field hockey', 'cross country', 'bocce', 'colts', 'mid-penn', 'athletic', 'athletics',
  'varsity', 'freshman', 'jv',
]

function wantsSportsAnswer(lower) {
  const wantsStats =
    /\b(record|records|score|scores|standing|standings|win|wins|loss|losses|tie|ties|game|games|match|season|roster|coach|playoff|playoffs|tournament|left|remaining|upcoming)\b/i.test(
      lower,
    )
  return SPORT_WORDS.some((w) => lower.includes(w)) || wantsStats || lower.includes('sports')
}

function formatScrapedSnippets(snippets) {
  if (!snippets || snippets.length === 0) return ''
  return snippets.map((s) => `• ${s.line}`).join('\n')
}

async function getSportSnippets(message, data, namedSport) {
  const scraped = extractRelevantSnippets(message, data, { maxSnippets: 6 })
  if (scraped.length > 0) return scraped
  if (!namedSport) return []
  return extractLatestForSport(namedSport, data, { maxSnippets: 6 })
}

async function getAIResponse(message) {
  if (isHomeworkHelpRequest(message)) {
    return HOMEWORK_REFUSAL_MESSAGE
  }
  const lower = message.toLowerCase()

  if (/^\s*(hello|hey|hi|yo|sup|hola)[!. ]*$/i.test(message)) {
    return `Hey! I'm CCGPT, your Cedar Cliff High School assistant. Ask me anything — sports updates, bell schedule, counselors, clubs, events, lunch, whatever you need. Go Colts!`
  }

  let data = []
  try {
    data = await loadSchoolData()
  } catch {
    data = []
  }

  let scraped = []
  try {
    scraped = extractRelevantSnippets(message, data, { maxSnippets: 6 })
  } catch {
    scraped = []
  }

  const namedSport = detectNamedSport(message)

  // Basketball chip or any "basketball" question → always try hard to surface live MaxPreps data.
  if (lower.includes('basketball')) {
    let bb = scraped.length > 0 ? scraped : extractLatestForSport('basketball', data, { maxSnippets: 6 })
    if (bb.length === 0) {
      // last-resort: girls basketball, JV, freshman pages still live under `basketball` regex,
      // so this only hits if the scrape has no basketball content at all.
      return `${schoolKnowledge['basketball games']}\n\nThe scraped feed doesn't have any basketball game data loaded right now. Try another topic, or check MaxPreps directly: https://www.maxpreps.com/pa/camp-hill/cedar-cliff-colts/basketball/`
    }
    return `${schoolKnowledge['basketball games']}\n\n**Most recent basketball updates from MaxPreps:**\n${formatScrapedSnippets(bb)}`
  }

  for (const [key, response] of Object.entries(schoolKnowledge)) {
    if (key === 'basketball games') continue
    if (lower.includes(key)) return response
  }

  if (/\b(ap|advanced\s+placement)\b/i.test(message) && /(course|courses|class|classes|offer|offered|offering|offerings|available|list|have|take|take\s+any|what)\b/i.test(lower)) {
    const apCourses = extractAPCourses(data)
    if (apCourses.length > 0) {
      const bullets = apCourses.map((c) => `• ${c}`).join('\n')
      return `🎓 **AP Courses Offered at Cedar Cliff**\n\n${bullets}\n\nTalk to your counselor for prerequisites, summer work, and scheduling. Full details: https://www.wssd.k12.pa.us/AdvancedPlacementCourses.aspx`
    }
  }

  if (isCourseListQuestion(message)) {
    const allCourses = extractCourses(data)
    if (allCourses.length > 0) {
      const deptNames = [...new Set(allCourses.map((c) => c.dept))]
      const query = parseCourseQuery(message, deptNames)
      const filtered = filterCourses(allCourses, {
        tags: query.tags,
        dept: query.dept,
      })

      const formatTitle = (c) => {
        const badge = c.tags.filter((t) => ['AP', 'Honors', 'Dual Enrollment', 'NCAA'].includes(t))
        const suffix = badge.length > 0 ? ` _(${badge.join(', ')})_` : ''
        return `• ${c.title}${suffix}`
      }

      const buildHeading = () => {
        const parts = []
        if (query.tags.length > 0) parts.push(query.tags.join(' + '))
        if (query.dept) parts.push(query.dept)
        const label = parts.length > 0 ? parts.join(' · ') : 'All'
        return `📚 **${label} Courses at Cedar Cliff**`
      }

      if (filtered.length === 0) {
        const label = [query.tags.join(' + '), query.dept].filter(Boolean).join(' + ') || 'that'
        return `I couldn't find any ${label} courses in the current WSSD curriculum pages. I have **${allCourses.length}** courses across ${deptNames.length} departments on file — try a different combination (e.g. "Dual Enrollment classes", "Honors math", "Art courses", "AP science").`
      }

      if (query.dept && query.tags.length === 0) {
        const bullets = filtered.map(formatTitle).join('\n')
        return `${buildHeading()}\n\n${bullets}\n\nThis list is from the West Shore School District curriculum guide. Prerequisites, credits, and weights vary — check with your counselor.`
      }

      if (query.tags.length > 0) {
        const grouped = groupCoursesByDept(filtered)
        const orderedDepts = COURSE_DEPARTMENTS.map((d) => d.name).filter((n) => grouped[n])
        const sections = orderedDepts
          .map((name) => {
            const items = grouped[name].map(formatTitle).join('\n')
            return `### ${name} (${grouped[name].length})\n${items}`
          })
          .join('\n\n')
        const count = filtered.length
        return `${buildHeading()} — ${count} course${count === 1 ? '' : 's'}\n\n${sections}\n\nWant narrower results? Try combining filters like "Honors English", "AP science", or "Dual Enrollment social studies".`
      }

      const total = filtered.length
      const grouped = groupCoursesByDept(filtered)
      const orderedDepts = COURSE_DEPARTMENTS.map((d) => d.name).filter((n) => grouped[n])
      const sections = orderedDepts
        .map((name) => {
          const items = grouped[name].map(formatTitle).join('\n')
          return `### ${name} (${grouped[name].length})\n${items}`
        })
        .join('\n\n')
      return `📚 **Cedar Cliff Course Catalog** — ${total} courses across ${deptNames.length} departments.\n\n${sections}\n\nTip: ask me to filter. Try "What AP science courses are offered?", "Honors English classes", "Dual Enrollment courses", or just "Math courses".`
    }
  }

  if (namedSport) {
    const sportSnips = await getSportSnippets(message, data, namedSport)
    if (sportSnips.length > 0) {
      const pretty = namedSport.replace(/\b\w/g, (c) => c.toUpperCase())
      return `Here's the latest on Cedar Cliff ${pretty} from MaxPreps:\n\n${formatScrapedSnippets(sportSnips)}`
    }
  }

  if (wantsSportsAnswer(lower)) {
    if (scraped.length > 0) {
      return `${schoolKnowledge.sports}\n\n**Latest sports updates from Cedar Cliff:**\n${formatScrapedSnippets(scraped)}`
    }
    return `${schoolKnowledge.sports}\n\nI don't have live updates pulled for that team yet. Try naming a specific sport (basketball, football, soccer, wrestling, etc.) and I'll pull the most recent MaxPreps info.`
  }

  if (lower.includes('schedule') || lower.includes('bell')) {
    return `🕐 **Cedar Cliff Bell Schedule**\n\n• **Period 1**: 7:25 – 8:10 AM\n• **Period 2**: 8:14 – 8:59 AM\n• **Period 3**: 9:03 – 9:48 AM\n• **Period 4**: 9:52 – 10:37 AM\n• **Lunch A**: 10:37 – 11:07 AM\n• **Lunch B**: 11:11 – 11:41 AM\n• **Period 5**: 11:45 AM – 12:30 PM\n• **Period 6**: 12:34 – 1:19 PM\n• **Period 7**: 1:23 – 2:08 PM\n• **Period 8**: 2:12 – 2:45 PM\n\nNote: Schedule may vary on early dismissal or delay days.`
  }
  if (lower.includes('lunch') || lower.includes('food') || lower.includes('cafeteria')) {
    return `🍽️ **Lunch Information**\n\nCedar Cliff has two lunch periods:\n• **Lunch A**: 10:37 – 11:07 AM\n• **Lunch B**: 11:11 – 11:41 AM\n\nThe cafeteria offers daily hot meals, salad bar, grab-and-go options, and snacks. Students can also bring their own lunch.\n\nFree and reduced lunch applications are available through the main office.`
  }
  if (lower.includes('parking') || lower.includes('drive') || lower.includes('car')) {
    return `🚗 **Student Parking**\n\nStudents who wish to drive to school must:\n1. Have a valid driver's license\n2. Register their vehicle with the main office\n3. Purchase a parking permit\n4. Park only in designated student parking areas\n\nParking permits are available at the beginning of each school year. Contact the main office for pricing and availability.`
  }

  if (scraped.length > 0) {
    return `Here's what I found from Cedar Cliff's recent pages:\n\n${formatScrapedSnippets(scraped)}`
  }

  return `I'm not sure I have that one on hand, but I can help with Cedar Cliff info — sports updates, bell schedule, counselors, clubs, events, lunch, credits and graduation requirements, course offerings, senior stuff, contact info, principal, and more. What are you looking for?`
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function titleFromMessage(text) {
  const trimmed = text.slice(0, 30).trim()
  return trimmed.length < text.length ? trimmed + '…' : trimmed
}

function formatMessageText(text) {
  return text.split('\n').map((line, i) => {
    const parts = []
    const boldRegex = /\*\*(.*?)\*\*/g
    let lastIndex = 0
    let match
    while ((match = boldRegex.exec(line)) !== null) {
      if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index))
      parts.push(<strong key={`${i}-${match.index}`}>{match[1]}</strong>)
      lastIndex = boldRegex.lastIndex
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex))
    return (
      <span key={i}>
        {parts.length > 0 ? parts : line}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    )
  })
}

function storageKey(uid) {
  return uid ? `ccgpt_conversations_${uid}` : null
}

function loadConversations(uid) {
  const key = storageKey(uid)
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

function saveConversations(uid, convos) {
  const key = storageKey(uid)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(convos))
  } catch { /* ignore */ }
}

function accountNeedsPasswordLink(u) {
  if (!u?.providerData) return false
  const ids = u.providerData.map((p) => p.providerId)
  return ids.includes('google.com') && !ids.includes('password')
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('ccgpt_theme')
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('ccgpt_theme', theme) } catch { /* ignore */ }
}

function App() {
  const [user, setUser] = useState(undefined)
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [linkPass, setLinkPass] = useState('')
  const [linkPass2, setLinkPass2] = useState('')
  const [linkErr, setLinkErr] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [theme, setTheme] = useState(getInitialTheme)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { applyTheme(theme) }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ?? null)
      setConversations(loadConversations(u?.uid))
      setActiveId(null)
    })
    return unsub
  }, [])

  const activeConvo = conversations.find((c) => c.id === activeId) || null
  const messages = activeConvo?.messages || []

  useEffect(() => {
    if (user?.uid) saveConversations(user.uid, conversations)
  }, [conversations, user])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isTyping])

  const startNewChat = useCallback(() => {
    setActiveId(null)
    setInputValue('')
    setIsTyping(false)
    inputRef.current?.focus()
  }, [])

  const sendMessage = useCallback(
    (text) => {
      const trimmed = text.trim()
      if (!trimmed || isTyping) return

      const userMsg = { id: generateId(), role: 'user', text: trimmed }
      const isNewConversation = !activeId
      const targetConvoId = isNewConversation ? generateId() : activeId
      setConversations((prev) => {
        if (!isNewConversation) {
          return prev.map((c) =>
            c.id === targetConvoId ? { ...c, messages: [...c.messages, userMsg] } : c,
          )
        }
        const newConvo = {
          id: targetConvoId,
          title: titleFromMessage(trimmed),
          messages: [userMsg],
          createdAt: Date.now(),
        }
        return [newConvo, ...prev]
      })
      setActiveId(targetConvoId)
      setInputValue('')
      setIsTyping(true)

      const runReply = async () => {
        let aiText
        if (isGeminiConfigured()) {
          try {
            aiText = await askGemini(trimmed)
          } catch (err) {
            console.error('Gemini error:', err)
            aiText = `Sorry, I couldn't reach the AI service right now. Error: ${err.message}\n\nPlease try again in a moment, or check the browser console for details.`
          }
        } else {
          try {
            aiText = await getAIResponse(trimmed)
          } catch (err) {
            console.error('Offline responder error:', err)
            aiText = `Sorry, something went wrong loading Cedar Cliff's latest info. Please try again in a moment.`
          }
        }

        const aiMsg = { id: generateId(), role: 'assistant', text: aiText }
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvoId ? { ...c, messages: [...c.messages, aiMsg] } : c,
          ),
        )
        setIsTyping(false)
      }

      void runReply()
    },
    [activeId, isTyping],
  )

  const onLinkPassword = async (e) => {
    e.preventDefault()
    setLinkErr('')
    if (linkPass.length < 6) {
      setLinkErr('Password must be at least 6 characters.')
      return
    }
    if (linkPass !== linkPass2) {
      setLinkErr('Passwords do not match.')
      return
    }
    setLinkBusy(true)
    try {
      await linkPasswordToCurrentUser(linkPass)
      setLinkPass('')
      setLinkPass2('')
    } catch (err) {
      const code = err?.code || ''
      setLinkErr(
        code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use'
          ? 'A password is already linked to this account.'
          : err?.message || 'Could not save password.',
      )
    } finally {
      setLinkBusy(false)
    }
  }

  if (user === undefined) {
    return (
      <div className="auth-loading">
        <img alt="Cedar Cliff logo" className="auth-loading__logo" src={cedarCliffLogo} />
      </div>
    )
  }
  if (!user) return <Auth />

  const handleSubmit = (e) => {
    e.preventDefault()
    sendMessage(inputValue)
  }

  const handleChipClick = (label) => {
    sendMessage(label)
  }

  const deleteConversation = (e, id) => {
    e.stopPropagation()
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  const showWelcome = messages.length === 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="sidebar__brand" type="button" onClick={startNewChat}>
          <img
            alt="Cedar Cliff logo"
            className="brand-mark brand-mark--small brand-mark__image brand-mark__image--sidebar"
            src={cedarCliffLogo}
          />
        </button>

        <button className="new-chat-button" type="button" onClick={startNewChat}>
          <span className="new-chat-button__plus" aria-hidden="true">+</span>
          New Chat
        </button>

        <div className="sidebar__history">
          {conversations.map((c) => (
            <button
              className={`history-item${c.id === activeId ? ' history-item--active' : ''}`}
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              title={c.title}
            >
              <span className="history-item__icon">💬</span>
              <span className="history-item__title">{c.title}</span>
              <span
                className="history-item__delete"
                role="button"
                tabIndex={0}
                aria-label="Delete conversation"
                onClick={(e) => deleteConversation(e, c.id)}
                onKeyDown={(e) => e.key === 'Enter' && deleteConversation(e, c.id)}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="main-panel">
        <header className="topbar">
          <div className="topbar__title">
            <img
              alt="Cedar Cliff logo"
              className="brand-mark brand-mark--tiny brand-mark__image brand-mark__image--tiny"
              src={cedarCliffLogo}
            />
            <div>
              <p className="topbar__name">CCGPT</p>
            </div>
          </div>

          <div className="topbar__actions">
            <span className="status-pill">
              <span className="status-pill__dot" aria-hidden="true" />
              Online
            </span>
            <button
              className="theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button className="signout-pill" type="button" onClick={() => logout()}>
              Sign Out
            </button>
          </div>
        </header>

        {accountNeedsPasswordLink(user) && (
          <div className="account-link-banner">
            <p className="account-link-banner__title">Add email &amp; password login</p>
            <p className="account-link-banner__copy">
              You signed in with Google. Set a password here if you want to sign in with email next time.
            </p>
            <form className="account-link-banner__form" onSubmit={onLinkPassword}>
              <input
                aria-label="New password"
                className="account-link-banner__input"
                type="password"
                placeholder="New password"
                value={linkPass}
                onChange={(e) => setLinkPass(e.target.value)}
                autoComplete="new-password"
                disabled={linkBusy}
              />
              <input
                aria-label="Confirm new password"
                className="account-link-banner__input"
                type="password"
                placeholder="Confirm password"
                value={linkPass2}
                onChange={(e) => setLinkPass2(e.target.value)}
                autoComplete="new-password"
                disabled={linkBusy}
              />
              <button className="account-link-banner__btn" type="submit" disabled={linkBusy}>
                {linkBusy ? 'Saving…' : 'Save password'}
              </button>
            </form>
            {linkErr && <p className="account-link-banner__err">{linkErr}</p>}
          </div>
        )}

        {showWelcome ? (
          <main className="welcome-screen">
            <section className="hero-panel">
              <img
                alt="Cedar Cliff logo"
                className="brand-mark brand-mark--hero brand-mark__image"
                src={cedarCliffLogo}
              />
              <h1>Welcome to CCGPT!</h1>
              <p className="hero-panel__copy">
                I'm your Cedar Cliff Highschool AI Assistant. Ask me about school
                info, sport schedules, counselors, and more!
              </p>
              <p className="gift-button" aria-hidden="true">
                🐴 Go Colts!
              </p>

              <div className="quick-actions">
                <p className="quick-actions__title">
                  Quick questions to get started
                </p>
                <div className="quick-actions__grid">
                  {quickActions.map((action) => (
                    <button
                      className="chip-button"
                      key={action.label}
                      type="button"
                      onClick={() => handleChipClick(action.label)}
                    >
                      <span className="chip-button__icon" aria-hidden="true">
                        {action.icon}
                      </span>
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </main>
        ) : (
          <main className="chat-screen">
            <div className="chat-messages">
              {messages.map((msg) => (
                <div
                  className={`chat-bubble chat-bubble--${msg.role}`}
                  key={msg.id}
                >
                  {msg.role === 'assistant' && (
                    <img
                      alt=""
                      className="chat-bubble__avatar"
                      src={cedarCliffLogo}
                    />
                  )}
                  <div className="chat-bubble__content">
                    {formatMessageText(msg.text)}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="chat-bubble chat-bubble--assistant">
                  <img
                    alt=""
                    className="chat-bubble__avatar"
                    src={cedarCliffLogo}
                  />
                  <div className="chat-bubble__content typing-indicator">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </main>
        )}

        <footer className="composer-wrap">
          <form className="composer" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              aria-label="Ask about Cedar Cliff"
              className="composer__input"
              placeholder="Ask about Cedar Cliff..."
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isTyping}
            />
            <button
              className="composer__send"
              type="submit"
              disabled={isTyping || !inputValue.trim()}
            >
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <p className="composer-wrap__meta">
            CCGPT can make mistakes. Check important Info.
          </p>
        </footer>
      </div>
    </div>
  )
}

export default App
