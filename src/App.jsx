import { useState, useRef, useCallback } from 'react'
import './App.css'

const SYSTEM_PROMPT = `Tu es un auditeur marketing senior. Analyse ce site web (screenshot) et donne un audit BREF et PRÉCIS.

RÈGLES :
- Maximum 6 problèmes, classés du plus grave au moins grave
- Chaque problème en 1 phrase MAX
- Pour chaque problème, donne les coordonnées APPROXIMATIVES en pourcentage (x%, y%) du CENTRE de l'élément problématique sur le screenshot. x=0 est le bord gauche, x=100 le bord droit. y=0 est le haut, y=100 le bas.

CATÉGORIES :
- IMG : image qui ne colle pas avec le texte/section
- TXT : texte mal positionné, illisible, ou mal hiérarchisé  
- FLOW : section qui casse la logique du parcours

RÉPONDS UNIQUEMENT en JSON valide, sans backticks ni markdown :
{
  "score": number de 1 à 10,
  "issues": [
    {
      "cat": "IMG|TXT|FLOW",
      "sev": "red|yellow|green",
      "x": number pourcentage horizontal (0-100),
      "y": number pourcentage vertical (0-100),
      "where": "localisation précise",
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
  const [mode, setMode] = useState(null) // 'url' | 'screenshot'
  const [url, setUrl] = useState('')
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [hoveredIssue, setHoveredIssue] = useState(null)
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

  const runAudit = async () => {
    if (!apiKey) return
    if (mode === 'screenshot' && images.length === 0) return
    if (mode === 'url' && !url.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      let auditImages = [...images]

      // If URL mode, capture screenshot first
      if (mode === 'url') {
        setLoadingMsg('Capture du site en cours...')
        const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`
        const screenshotRes = await fetch(screenshotUrl)

        if (!screenshotRes.ok) throw new Error('Impossible de capturer le site. Vérifie l\'URL.')

        const blob = await screenshotRes.blob()
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })

        auditImages = [{
          name: 'screenshot-url',
          data: base64.split(',')[1],
          type: blob.type || 'image/png',
          preview: base64,
        }]
        setImages(auditImages)
      }

      setLoadingMsg('Analyse marketing en cours...')

      const parts = []
      auditImages.forEach((img) => {
        parts.push({ inlineData: { mimeType: img.type, data: img.data } })
      })
      parts.push({ text: SYSTEM_PROMPT + `\n\nAnalyse ${auditImages.length > 1 ? 'ces ' + auditImages.length + ' screenshots' : 'ce screenshot'}.` })

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
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

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
            <input
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button onClick={saveKey} disabled={!apiKey}>OK</button>
          </div>
          <small>Gratuit → <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a></small>
        </div>
      )}

      {!loading && !result && (
        <div className="content fade-in">
          {/* Mode selector */}
          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'url' ? 'mode-active' : ''}`}
              onClick={() => { setMode('url'); setError(null) }}
            >
              <span className="mode-icon">🔗</span>
              URL du site
            </button>
            <button
              className={`mode-btn ${mode === 'screenshot' ? 'mode-active' : ''}`}
              onClick={() => { setMode('screenshot'); setError(null) }}
            >
              <span className="mode-icon">📸</span>
              Screenshots
            </button>
          </div>

          {/* URL Input */}
          {mode === 'url' && (
            <div className="fade-in">
              <input
                className="url-input"
                type="url"
                placeholder="https://exemple.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="run-btn"
                onClick={runAudit}
                disabled={!apiKey || !url.trim()}
              >
                Auditer ce site
              </button>
            </div>
          )}

          {/* Screenshot Upload */}
          {mode === 'screenshot' && (
            <div className="fade-in">
              <div
                className="dropzone"
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover') }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop-hover')}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} hidden />
                <div className="drop-icon">📸</div>
                <p>Screenshots du site ici</p>
                <small>Glisse ou clique · PNG, JPG</small>
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
                    Auditer {images.length > 1 ? `(${images.length} pages)` : ''}
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
              <circle
                cx="30" cy="30" r="25" fill="none"
                stroke={result.score >= 7 ? '#22c55e' : result.score >= 5 ? '#eab308' : '#ef4444'}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(result.score / 10) * 157} 157`}
                transform="rotate(-90 30 30)"
              />
              <text x="30" y="34" textAnchor="middle" fill="#e8e6e1" fontSize="18" fontWeight="700"
                fontFamily="monospace">{result.score}</text>
            </svg>
            <p className="verdict">{result.verdict}</p>
          </div>

          {/* Annotated Screenshot */}
          {images.length > 0 && (
            <div className="annotated-wrap">
              <div className="annotated-label">📍 Problèmes détectés</div>
              {images.map((img, imgIdx) => (
                <div key={imgIdx} className="annotated-img">
                  <img src={img.preview} alt="screenshot" />
                  {result.issues?.map((issue, i) => {
                    const s = SEV[issue.sev] || SEV.yellow
                    const isHovered = hoveredIssue === i
                    return (
                      <div
                        key={i}
                        className={`marker ${isHovered ? 'marker-active' : ''}`}
                        style={{
                          left: `${issue.x || 50}%`,
                          top: `${issue.y || 50}%`,
                          background: s.border,
                          zIndex: isHovered ? 10 : 1,
                          transform: isHovered ? 'translate(-50%,-50%) scale(1.4)' : 'translate(-50%,-50%) scale(1)',
                        }}
                        onMouseEnter={() => setHoveredIssue(i)}
                        onMouseLeave={() => setHoveredIssue(null)}
                      >
                        {i + 1}
                        {isHovered && (
                          <div className="marker-tooltip">{issue.what}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="issues-list">
            {result.issues?.map((issue, i) => {
              const s = SEV[issue.sev] || SEV.yellow
              return (
                <div
                  key={i}
                  className={`issue ${hoveredIssue === i ? 'issue-highlight' : ''}`}
                  style={{ borderLeftColor: s.border, background: s.bg }}
                  onMouseEnter={() => setHoveredIssue(i)}
                  onMouseLeave={() => setHoveredIssue(null)}
                >
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
          </div>

          <button className="reset-btn" onClick={() => { setResult(null); setImages([]); setUrl(''); setMode(null); setError(null); setHoveredIssue(null) }}>
            ← Nouvel audit
          </button>
        </div>
      )}
    </div>
  )
}

export default App
