import { useState } from 'react'
import IssueCard, { SEV } from './IssueCard'

export default function PageSection({ section, sectionResult, index, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const [hovered, setHovered] = useState(null)

  const issues = sectionResult?.issues || []
  const hasIssues = issues.length > 0
  const score = sectionResult?.score
  const scoreColor = score >= 7 ? '#22c55e' : score >= 5 ? '#eab308' : '#ef4444'

  return (
    <div className={`section-block ${hasIssues ? '' : 'section-clean'}`}>
      {/* Header bar */}
      <button className="section-header" onClick={() => setOpen(!open)}>
        <span className="section-idx">{index + 1}</span>
        <span className="section-label">{section.label}</span>
        {score != null && (
          <span className="section-score" style={{ color: scoreColor }}>{score}/10</span>
        )}
        <span className="section-badge">
          {hasIssues ? `${issues.length} pb` : '✅'}
        </span>
        <span className={`chev ${open ? 'chev-open' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="section-body anim-in">
          {/* Annotated screenshot */}
          <div className="ann-img">
            <img src={section.preview} alt={section.label} />
            {issues.map((issue, i) => {
              const s = SEV[issue.sev] || SEV.yellow
              const active = hovered === i
              return (
                <div
                  key={i}
                  className={`pin ${active ? 'pin-active' : ''}`}
                  style={{
                    left: `${issue.x ?? 50}%`,
                    top: `${issue.y ?? 50}%`,
                    background: s.border,
                    zIndex: active ? 10 : 1,
                    transform: active
                      ? 'translate(-50%,-50%) scale(1.5)'
                      : 'translate(-50%,-50%) scale(1)',
                  }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {i + 1}
                  {active && <div className="pin-tip">{issue.what}</div>}
                </div>
              )
            })}
          </div>

          {/* Issue list */}
          {hasIssues ? (
            <div className="issue-list">
              {issues.map((issue, i) => (
                <IssueCard
                  key={i}
                  issue={issue}
                  index={i}
                  isHovered={hovered === i}
                  onHover={() => setHovered(i)}
                  onLeave={() => setHovered(null)}
                />
              ))}
            </div>
          ) : (
            <div className="section-ok">✅ RAS — cette section est propre</div>
          )}

          {sectionResult?.note && (
            <div className="section-note">💬 {sectionResult.note}</div>
          )}
        </div>
      )}
    </div>
  )
}
