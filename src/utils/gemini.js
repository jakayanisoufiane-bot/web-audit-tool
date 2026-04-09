const PROMPT = `Tu es un auditeur marketing senior. Analyse ce screenshot d'une section de page web.

RÈGLES :
- Maximum 4 problèmes, classés du plus grave au moins grave
- Chaque problème en 1 PHRASE MAX
- Coordonnées APPROXIMATIVES en % (x%, y%) du centre de l'élément problématique. x=0 gauche, x=100 droite. y=0 haut, y=100 bas.

CATÉGORIES :
- IMG : image incohérente avec le texte ou la section
- TXT : texte mal positionné, illisible, mal hiérarchisé, mauvais contraste
- FLOW : rupture de logique dans le parcours ou l'enchaînement

RÉPONDS UNIQUEMENT en JSON valide, sans backticks :
{
  "score": number 1-10,
  "issues": [
    {
      "cat": "IMG|TXT|FLOW",
      "sev": "red|yellow|green",
      "x": number 0-100,
      "y": number 0-100,
      "where": "localisation courte",
      "what": "problème en 1 phrase",
      "fix": "solution en 1 phrase"
    }
  ],
  "note": "1 phrase sur cette section"
}`

/**
 * Analyse a single screenshot section with Gemini
 * Returns parsed JSON result or null on failure
 */
export async function analyzeSection(apiKey, imageBase64, mimeType, context = '') {
  const parts = [
    { inlineData: { mimeType, data: imageBase64 } },
    { text: PROMPT + (context ? `\n\nContexte : ${context}` : '') },
  ]

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

  const text = data.candidates?.[0]?.content?.parts
    ?.filter(p => p.text)
    .map(p => p.text)
    .join('') || ''

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Réponse non structurée de Gemini')

  return JSON.parse(match[0])
}

/**
 * Aggregate multiple section results into a global report
 */
export function aggregateResults(sectionResults) {
  const allIssues = []
  let totalScore = 0
  let count = 0

  sectionResults.forEach((res, idx) => {
    if (!res) return
    count++
    totalScore += res.score || 0
    ;(res.issues || []).forEach(issue => {
      allIssues.push({ ...issue, sectionIdx: idx })
    })
  })

  return {
    score: count > 0 ? Math.round(totalScore / count) : 0,
    issues: allIssues,
    totalSections: sectionResults.length,
    sectionsWithIssues: sectionResults.filter(r => r?.issues?.length > 0).length,
  }
}
