import { useState, useRef, useCallback } from 'react'
import './App.css'

const MAX_PAGES = 6
const SECTION_HEIGHT = 900 // px per section slice

const buildPrompt = (sectionLabels) => `Tu es un auditeur marketing senior. Analyse ces screenshots de sections de pages web et donne un audit BREF et PRÉCIS.

Les screenshots sont numérotés. Chacun représente une section verticale d'une page (du haut vers le bas) :
${sectionLabels.map((l, i) => `- Screenshot ${i + 1} : ${l}`).join('\n')}

RÈGLES :
- Maximum 3 problèmes PAR SCREENSHOT, classés du plus grave au moins grave
- Chaque problème en 1 phrase MAX
- Pour chaque problème, donne les coordonnées APPROXIMATIVES en pourcentage (x%, y%) du CENTRE de l'élément problématique sur SON screenshot. x=0 bord gauche, x=100 bord droit. y=0 haut du screenshot, y=100 bas du screenshot.
- Indique OBLIGATOIREMENT à quel screenshot (numéro) chaque problème correspond

CATÉGORIES :
- IMG : image qui ne colle pas avec le texte/section
- TXT : texte mal positionné, illisible, ou mal hiérarchisé  
- FLOW : section qui casse la logique du parcours

RÉPONDS UNIQUEMENT en JSON valide, sans backticks ni markdown :
{
  "score": number de 1 à 10 (global),
  "issues": [
    {
      "page": number du screenshot (commence à 1),
      "cat": "IMG|TXT|FLOW",
      "sev": "red|yellow|green",
      "x": number pourcentage horizontal (0-100),
      "y": number pourcentage vertical (0-100),
      "where": "localisation précise sur cette section",
      "what": "problème en 1 phrase",
      "fix": "solution en 1 phrase"
    }
  ],
  "verdict": "1 phrase résumé global"
}`

const SEV = {
  red: { emoji: '🔴', label: 'Critique', bg: 'rgba(220,38,38,0.08)', border: '#dc2626' },
  yellow: { emoji: '🟡', label: 'Important', bg: 'rgba(217,119,6,0.08)', border: '#d97706' },
  green: { emoji: '🟢', label: 'Mineur', bg: 'rgba(22,163,74,0.08)', border: '#16a34a' },
}
const CAT = { IMG: 'Image ↔ Texte', TXT: 'Positionnement', FLOW: 'Logique' }

function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '')
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('gemini_key'))
  const [mode, setMode] = useState(null)
  const [url, setUrl] = useState('')
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [hoveredIssue, setHoveredIssue] = useState(null)
  const [expandedPage, setExpandedPage] = useState(null)
  const fileRef = useRef()

  const saveKey = () => {
    localStorage.setItem('gemini_key', apiKey)
    setShowSettings(false)
  }

  const handleFiles = useCallback((files) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        setImages((prev) => [...prev, {
          name: file.name,
          label: file.name,
          data: e.target.result.split(',')[1],
          type: file.type,
          preview: e.target.result,
        }])
      }
      reader.readAsDataURL(file)
    })
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drop-hover')
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  // Capture full-page screenshot via microlink
  const captureFullPage = async (pageUrl) => {
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(pageUrl)}&screenshot=true&screenshot.fullPage=true&meta=false`
    const res = await fetch(apiUrl)
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 'success' || !json.data?.screenshot?.url) return null

    const imgRes = await fetch(json.data.screenshot.url)
    if (!imgRes.ok) return null
    const blob = await imgRes.blob()
    return blob
  }

  // Slice a full-page image blob into section chunks
  const sliceIntoSections = (blob, pageLabel) => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const sections = []
        const totalHeight = img.height
        const width = img.width
        const numSections = Math.ceil(totalHeight / SECTION_HEIGHT)

        for (let i = 0; i < numSections; i++) {
          const canvas = document.createElement('canvas')
          const sliceH = Math.min(SECTION_HEIGHT, totalHeight - i * SECTION_HEIGHT)
          canvas.width = width
          canvas.height = sliceH

          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, i * SECTION_HEIGHT, width, sliceH, 0, 0, width, sliceH)

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          sections.push({
            name: `${pageLabel} - Section ${i + 1}`,
            label: `${pageLabel} — Section ${i + 1}/${numSections}`,
            data: dataUrl.split(',')[1],
            type: 'image/jpeg',
            preview: dataUrl,
          })
        }
        resolve(sections)
      }
      img.src = URL.createObjectURL(blob)
    })
  }

  // Extract internal links from HTML
  const extractLinks = (html, baseUrl) => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const anchors = doc.querySelectorAll('a[href]')
    const base = new URL(baseUrl)
    const links = new Set()
    const mainUrl = baseUrl.replace(/\/$/, '')
    links.add(mainUrl)

    // Also try nav, header, footer links specifically
    anchors.forEach((a) => {
      try {
        const href = a.getAttribute('href')
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return
        const resolved = new URL(href, baseUrl)
        if (resolved.hostname !== base.hostname) return
        // Skip files, anchors, queries
        if (/\.(pdf|jpg|png|gif|svg|css|js|zip)$/i.test(resolved.pathname)) return
        const clean = resolved.origin + resolved.pathname.replace(/\/$/, '')
        if (clean !== mainUrl) links.add(clean)
      } catch (e) { /* skip */ }
    })
    return [...links].slice(0, MAX_PAGES)
  }

  const runAudit = async () => {
    if (!apiKey) return
    if (mode === 'screenshot' && images.length === 0) return
    if (mode === 'url' && !url.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      let auditImages = [...images]

      if (mode === 'url') {
        // Step 1: Discover pages
        setLoadingMsg('Découverte des pages du site...')
        let pages = [url.replace(/\/$/, '')]

        try {
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
          const htmlRes = await fetch(proxyUrl)
          if (htmlRes.ok) {
            const htmlData = await htmlRes.json()
            if (htmlData.contents) {
              pages = extractLinks(htmlData.contents, url)
            }
          }
        } catch (e) { /* fallback to main URL only */ }

        setLoadingMsg(`${pages.length} page(s) trouvée(s). Capture en cours...`)

        // Step 2: Capture full-page screenshots and slice into sections
        auditImages = []
        for (let i = 0; i < pages.length; i++) {
          const pagePath = new URL(pages[i]).pathname || '/'
          setLoadingMsg(`Capture page ${i + 1}/${pages.length} : ${pagePath}`)

          const blob = await captureFullPage(pages[i])
          if (blob) {
            const sections = await sliceIntoSections(blob, pagePath)
            auditImages.push(...sections)
          }

          // Rate limit delay between pages
          if (i < pages.length - 1) await new Promise(r => setTimeout(r, 2000))
        }

        if (auditImages.length === 0) throw new Error('Impossible de capturer le site. Vérifie l\'URL.')
        setImages(auditImages)
      }

      // Step 3: Send all section screenshots to Gemini
      setLoadingMsg(`Analyse de ${auditImages.length} section(s)...`)

      const pageLabels = auditImages.map((img) => img.label || img.name)
      const parts = []
      auditImages.forEach((img) => {
        parts.push({ inlineData: { mimeType: img.type, data: img.data } })
      })
      parts.push({ text: buildPrompt(pageLabels) })

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        }
      )

      const data = await res.json()
      if (data.error) throw new Error(data.error.message)

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Réponse non structurée')
      setResult(JSON.parse(jsonMatch[0]))
      // Auto-expand first section that has issues
      const parsed = JSON.parse(jsonMatch[0])
      const firstWithIssue = parsed.issues?.[0]?.page || 1
      setExpandedPage(firstWithIssue)
      setResult(parsed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  // Group issues by page/section number
  const issuesByPage = {}
  result?.issues?.forEach((issue) => {
    const p = issue.page || 1
    if (!issuesByPage[p]) issuesByPage[p] = []
    issuesByPage[p].push(issue)
  })

  return (
    <div className="app">
      <header>
        <div className="header-left">
          <span className="logo">⚡</span>
          <h1>WebAudit</h1>
          <span className="badge">MKT</span>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
      </header>

      {showSettings && (
        <div className="settings fade-in">
          <label>Clé API Gemini</label>
          <div className="key-row">
            <input type="password" placeholder="AIza..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button onClick={saveKey} disabled={!apiKey}>OK</button>
          </div>
          <small>Gratuit → <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a></small>
        </div>
      )}

      {!loading && !result && (
        <div className="content fade-in">
          <div className="mode-selector">
            <button className={`mode-btn ${mode === 'url' ? 'mode-active' : ''}`} onClick={() => { setMode('url'); setError(null) }}>
              <span className="mode-icon">🔗</span>URL du site
            </button>
            <button className={`mode-btn ${mode === 'screenshot' ? 'mode-active' : ''}`} onClick={() => { setMode('screenshot'); setError(null) }}>
              <span className="mode-icon">📸</span>Screenshots
            </button>
          </div>

          {mode === 'url' && (
            <div className="fade-in">
              <input className="url-input" type="url" placeholder="https://exemple.com" value={url} onChange={(e) => setUrl(e.target.value)} />
              <small className="url-hint">Capture toutes les pages · Découpe chaque page en sections · Analyse chaque section</small>
              <button className="run-btn" onClick={runAudit} disabled={!apiKey || !url.trim()}>Auditer tout le site</button>
            </div>
          )}

          {mode === 'screenshot' && (
            <div className="fade-in">
              <div className="dropzone" onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover') }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop-hover')}
                onClick={() => fileRef.current?.click()}>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} hidden />
                <div className="drop-icon">📸</div>
                <p>Screenshots des sections ici</p>
                <small>Glisse ou clique · PNG, JPG · 1 screenshot par section de page</small>
              </div>
              {images.length > 0 && (
                <>
                  <div className="thumbs">
                    {images.map((img, i) => (
                      <div key={i} className="thumb">
                        <img src={img.preview} alt={img.name} />
                        <button onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                  <button className="run-btn" onClick={runAudit} disabled={!apiKey}>
                    Auditer ({images.length} section{images.length > 1 ? 's' : ''})
                  </button>
                </>
              )}
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {loading && (
        <div className="loading fade-in">
          <div className="spinner" />
          <p>{loadingMsg || 'Analyse en cours...'}</p>
        </div>
      )}

      {result && (
        <div className="results fade-in">
          <div className="score-card">
            <svg viewBox="0 0 60 60" width="72" height="72">
              <circle cx="30" cy="30" r="25" fill="none" stroke="#1c1c28" strokeWidth="5" />
              <circle cx="30" cy="30" r="25" fill="none"
                stroke={result.score >= 7 ? '#22c55e' : result.score >= 5 ? '#eab308' : '#ef4444'}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(result.score / 10) * 157} 157`}
                transform="rotate(-90 30 30)" />
              <text x="30" y="34" textAnchor="middle" fill="#e8e6e1" fontSize="18" fontWeight="700" fontFamily="monospace">{result.score}</text>
            </svg>
            <div>
              <p className="verdict">{result.verdict}</p>
              <p className="page-count">{images.length} section{images.length > 1 ? 's' : ''} · {result.issues?.length || 0} problème{(result.issues?.length || 0) > 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Per-section results */}
          {images.map((img, imgIdx) => {
            const pageNum = imgIdx + 1
            const pageIssues = issuesByPage[pageNum] || []
            const isExpanded = expandedPage === pageNum
            const hasIssues = pageIssues.length > 0

            return (
              <div key={imgIdx} className={`page-section ${hasIssues ? '' : 'page-clean'}`}>
                <button className="page-header" onClick={() => setExpandedPage(isExpanded ? null : pageNum)}>
                  <span className={`page-num ${hasIssues ? '' : 'page-num-clean'}`}>{pageNum}</span>
                  <span className="page-label">{img.label || img.name}</span>
                  <span className="page-issue-count">
                    {hasIssues ? `${pageIssues.length} problème${pageIssues.length > 1 ? 's' : ''}` : '✅'}
                  </span>
                  <span className={`page-chevron ${isExpanded ? 'chevron-open' : ''}`}>▼</span>
                </button>

                {isExpanded && (
                  <div className="page-content fade-in">
                    <div className="annotated-img">
                      <img src={img.preview} alt={img.label} />
                      {pageIssues.map((issue, i) => {
                        const globalI = result.issues.indexOf(issue)
                        const s = SEV[issue.sev] || SEV.yellow
                        const isHovered = hoveredIssue === globalI
                        return (
                          <div key={i}
                            className={`marker ${isHovered ? 'marker-active' : ''}`}
                            style={{
                              left: `${issue.x || 50}%`, top: `${issue.y || 50}%`,
                              background: s.border, zIndex: isHovered ? 10 : 1,
                              transform: isHovered ? 'translate(-50%,-50%) scale(1.4)' : 'translate(-50%,-50%) scale(1)',
                            }}
                            onMouseEnter={() => setHoveredIssue(globalI)}
                            onMouseLeave={() => setHoveredIssue(null)}>
                            {i + 1}
                            {isHovered && <div className="marker-tooltip">{issue.what}</div>}
                          </div>
                        )
                      })}
                    </div>

                    <div className="issues-list">
                      {pageIssues.map((issue, i) => {
                        const globalI = result.issues.indexOf(issue)
                        const s = SEV[issue.sev] || SEV.yellow
                        return (
                          <div key={i}
                            className={`issue ${hoveredIssue === globalI ? 'issue-highlight' : ''}`}
                            style={{ borderLeftColor: s.border, background: s.bg }}
                            onMouseEnter={() => setHoveredIssue(globalI)}
                            onMouseLeave={() => setHoveredIssue(null)}>
                            <div className="issue-header">
                              <span className="issue-num" style={{ background: s.border }}>{i + 1}</span>
                              <span className="issue-cat">{CAT[issue.cat] || issue.cat}</span>
                              <span style={{ color: s.border, fontWeight: 700, fontSize: 12, marginLeft: 'auto' }}>{s.emoji} {s.label}</span>
                            </div>
                            <div className="issue-where">📍 {issue.where}</div>
                            <div className="issue-what">{issue.what}</div>
                            <div className="issue-fix">→ {issue.fix}</div>
                          </div>
                        )
                      })}
                      {!hasIssues && <div className="no-issues">✅ Aucun problème détecté sur cette section</div>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <button className="reset-btn" onClick={() => { setResult(null); setImages([]); setUrl(''); setMode(null); setError(null); setHoveredIssue(null); setExpandedPage(null) }}>
            ← Nouvel audit
          </button>
        </div>
      )}
    </div>
  )
}

export default App
