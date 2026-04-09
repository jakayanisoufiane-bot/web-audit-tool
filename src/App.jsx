import { useState, useRef, useCallback } from 'react'
import { analyzeSection, aggregateResults } from './utils/gemini'
import { captureFullPage, captureMultiViewport, sliceImage, blobToSection, fileToSection } from './utils/screenshot'
import { discoverPages } from './utils/crawler'
import PageSection from './components/PageSection'
import './App.css'

function App() {
  // Config
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_key') || '')
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('gemini_key'))

  // Input
  const [mode, setMode] = useState(null) // 'url' | 'screenshot'
  const [url, setUrl] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState([]) // raw File objects for preview
  const fileRef = useRef()

  // Audit state
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ step: '', detail: '', current: 0, total: 0 })
  const [sections, setSections] = useState([])       // { label, data, type, preview }
  const [sectionResults, setSectionResults] = useState([]) // Gemini results per section
  const [global, setGlobal] = useState(null)           // aggregated result
  const [error, setError] = useState(null)

  // ── Config ──
  const saveKey = () => {
    localStorage.setItem('gemini_key', apiKey)
    setShowSettings(false)
  }

  // ── File handling ──
  const addFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/'))
    setUploadedFiles(prev => [...prev, ...valid])
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('drop-on')
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const removeFile = (i) => setUploadedFiles(prev => prev.filter((_, j) => j !== i))

  // ── Preview thumbnails from File objects ──
  const [previews, setPreviews] = useState([])
  const updatePreviews = useCallback(async (files) => {
    const urls = await Promise.all(files.map(f => {
      return new Promise(resolve => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.readAsDataURL(f)
      })
    }))
    setPreviews(urls)
  }, [])

  // Keep previews in sync
  useState(() => {
    updatePreviews(uploadedFiles)
  }, [uploadedFiles])

  // ── Main audit flow ──
  const runAudit = async () => {
    if (!apiKey) return
    setRunning(true)
    setError(null)
    setSections([])
    setSectionResults([])
    setGlobal(null)

    try {
      let allSections = []

      if (mode === 'url') {
        // Phase 1: Discover pages
        setProgress({ step: 'Découverte', detail: 'Recherche des pages du site...', current: 0, total: 0 })
        const pages = await discoverPages(url)
        setProgress({ step: 'Découverte', detail: `${pages.length} page(s) trouvée(s)`, current: 0, total: pages.length })

        // Phase 2: Capture + slice each page
        for (let p = 0; p < pages.length; p++) {
          const path = new URL(pages[p]).pathname || '/'
          setProgress({ step: 'Capture', detail: `Page ${p + 1}/${pages.length} : ${path}`, current: p + 1, total: pages.length })

          // Try full-page screenshot first
          const blob = await captureFullPage(pages[p], (status) => {
            setProgress({ step: 'Capture', detail: `${path} — ${status}`, current: p + 1, total: pages.length })
          })

          if (blob && blob.size > 10000) {
            // Full page captured → slice into sections
            const slices = await sliceImage(blob, path)
            allSections.push(...slices)
          } else {
            // Fallback: capture multiple viewport positions
            setProgress({ step: 'Capture', detail: `${path} — Capture multi-viewport...`, current: p + 1, total: pages.length })
            const viewportBlobs = await captureMultiViewport(pages[p], 5)
            for (let v = 0; v < viewportBlobs.length; v++) {
              const section = await blobToSection(viewportBlobs[v], `${path} — viewport ${v + 1}/${viewportBlobs.length}`)
              allSections.push(section)
            }
          }

          // Rate limit between pages
          if (p < pages.length - 1) await sleep(2000)
        }

        if (allSections.length === 0) {
          throw new Error('Impossible de capturer le site. Vérifie l\'URL.')
        }

      } else {
        // Screenshot mode: convert each file to a section
        for (const file of uploadedFiles) {
          const section = await fileToSection(file)
          allSections.push(section)
        }
      }

      setSections(allSections)

      // Phase 3: Analyze each section individually
      const results = []
      for (let i = 0; i < allSections.length; i++) {
        setProgress({
          step: 'Analyse',
          detail: `Section ${i + 1}/${allSections.length} : ${allSections[i].label}`,
          current: i + 1,
          total: allSections.length,
        })

        try {
          const res = await analyzeSection(
            apiKey,
            allSections[i].data,
            allSections[i].type,
            allSections[i].label,
          )
          results.push(res)
        } catch (err) {
          console.warn(`Section ${i + 1} failed:`, err.message)
          results.push(null)
        }

        // Update results progressively
        setSectionResults([...results])

        // Rate limit between Gemini calls
        if (i < allSections.length - 1) await sleep(1200)
      }

      // Phase 4: Aggregate
      setGlobal(aggregateResults(results))

    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setSections([])
    setSectionResults([])
    setGlobal(null)
    setUploadedFiles([])
    setPreviews([])
    setUrl('')
    setMode(null)
    setError(null)
  }

  const canRun = apiKey && (
    (mode === 'url' && url.trim()) ||
    (mode === 'screenshot' && uploadedFiles.length > 0)
  )

  const done = global != null
  const scoreColor = global ? (global.score >= 7 ? '#22c55e' : global.score >= 5 ? '#eab308' : '#ef4444') : '#666'

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo-box">⚡</span>
          <h1 className="logo-text">WebAudit</h1>
          <span className="tag">MKT</span>
        </div>
        <button className="gear" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
      </header>

      {/* ── Settings ── */}
      {showSettings && (
        <div className="panel anim-in">
          <label className="panel-label">Clé API Gemini</label>
          <div className="key-row">
            <input type="password" placeholder="AIza..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button onClick={saveKey} disabled={!apiKey}>OK</button>
          </div>
          <small>Gratuit → <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a></small>
        </div>
      )}

      {/* ── Input ── */}
      {!running && !done && (
        <div className="input-area anim-in">
          <div className="mode-row">
            {[{ k: 'url', ico: '🔗', t: 'URL du site' }, { k: 'screenshot', ico: '📸', t: 'Screenshots' }].map(m => (
              <button key={m.k} className={`mode-btn ${mode === m.k ? 'mode-on' : ''}`} onClick={() => { setMode(m.k); setError(null) }}>
                <span className="mode-ico">{m.ico}</span>{m.t}
              </button>
            ))}
          </div>

          {mode === 'url' && (
            <div className="anim-in">
              <input className="url-field" type="url" placeholder="https://exemple.com" value={url} onChange={e => setUrl(e.target.value)} />
              <p className="hint">Découvre les pages, capture chaque page entière, découpe en sections, analyse chaque section</p>
              <button className="go-btn" onClick={runAudit} disabled={!canRun}>Lancer l'audit complet</button>
            </div>
          )}

          {mode === 'screenshot' && (
            <div className="anim-in">
              <div className="drop"
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drop-on') }}
                onDragLeave={e => e.currentTarget.classList.remove('drop-on')}
                onClick={() => fileRef.current?.click()}>
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => { addFiles(e.target.files); updatePreviews([...uploadedFiles, ...Array.from(e.target.files).filter(f => f.type.startsWith('image/'))]) }} hidden />
                <span className="drop-ico">📸</span>
                <p>Glisse tes screenshots ici</p>
                <small>PNG, JPG · 1 screenshot par section de page</small>
              </div>

              {uploadedFiles.length > 0 && (
                <>
                  <div className="thumb-row">
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="thumb">
                        {previews[i] && <img src={previews[i]} alt={f.name} />}
                        <button className="thumb-x" onClick={() => { removeFile(i); updatePreviews(uploadedFiles.filter((_, j) => j !== i)) }}>×</button>
                      </div>
                    ))}
                  </div>
                  <button className="go-btn" onClick={runAudit} disabled={!canRun}>
                    Auditer ({uploadedFiles.length} section{uploadedFiles.length > 1 ? 's' : ''})
                  </button>
                </>
              )}
            </div>
          )}

          {error && <div className="err">{error}</div>}
        </div>
      )}

      {/* ── Progress ── */}
      {running && (
        <div className="progress-area anim-in">
          <div className="spin" />
          <p className="prog-step">{progress.step}</p>
          <p className="prog-detail">{progress.detail}</p>
          {progress.total > 0 && (
            <div className="prog-bar-wrap">
              <div className="prog-bar" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          )}

          {/* Show results as they come in */}
          {sections.length > 0 && sectionResults.length > 0 && (
            <div className="early-results">
              <p className="early-title">{sectionResults.filter(Boolean).length}/{sections.length} sections analysées</p>
            </div>
          )}
        </div>
      )}

      {/* ── Results ── */}
      {done && (
        <div className="results anim-in">
          {/* Global score */}
          <div className="global-score">
            <svg viewBox="0 0 60 60" width="80" height="80">
              <circle cx="30" cy="30" r="25" fill="none" stroke="#1c1c28" strokeWidth="5" />
              <circle cx="30" cy="30" r="25" fill="none" stroke={scoreColor}
                strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(global.score / 10) * 157} 157`}
                transform="rotate(-90 30 30)" />
              <text x="30" y="34" textAnchor="middle" fill="#e8e6e1" fontSize="18" fontWeight="700" fontFamily="monospace">{global.score}</text>
            </svg>
            <div className="global-meta">
              <p className="global-stat">
                {global.totalSections} section{global.totalSections > 1 ? 's' : ''} analysée{global.totalSections > 1 ? 's' : ''} · {global.issues.length} problème{global.issues.length > 1 ? 's' : ''}
              </p>
              <p className="global-breakdown">
                🔴 {global.issues.filter(i => i.sev === 'red').length}
                {' · '}🟡 {global.issues.filter(i => i.sev === 'yellow').length}
                {' · '}🟢 {global.issues.filter(i => i.sev === 'green').length}
              </p>
            </div>
          </div>

          {/* Per-section */}
          {sections.map((section, i) => (
            <PageSection
              key={i}
              section={section}
              sectionResult={sectionResults[i]}
              index={i}
              defaultOpen={sectionResults[i]?.issues?.length > 0}
            />
          ))}

          <button className="reset-btn" onClick={reset}>← Nouvel audit</button>
        </div>
      )}
    </div>
  )
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export default App
