const SEV = {
  red: { emoji: '🔴', label: 'Critique', border: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  yellow: { emoji: '🟡', label: 'Important', border: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  green: { emoji: '🟢', label: 'Mineur', border: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
}
const CAT = { IMG: 'Image ↔ Texte', TXT: 'Positionnement', FLOW: 'Logique' }

export { SEV }

export default function IssueCard({ issue, index, isHovered, onHover, onLeave }) {
  const s = SEV[issue.sev] || SEV.yellow
  return (
    <div
      className={`issue ${isHovered ? 'issue-hl' : ''}`}
      style={{ borderLeftColor: s.border, background: s.bg }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div className="issue-top">
        <span className="issue-num" style={{ background: s.border }}>{index + 1}</span>
        <span className="issue-cat">{CAT[issue.cat] || issue.cat}</span>
        <span className="issue-sev" style={{ color: s.border }}>{s.emoji} {s.label}</span>
      </div>
      <div className="issue-where">📍 {issue.where}</div>
      <div className="issue-what">{issue.what}</div>
      <div className="issue-fix">→ {issue.fix}</div>
    </div>
  )
}
