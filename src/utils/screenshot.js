const SECTION_HEIGHT = 900 // pixels per slice

/**
 * Capture a full-page screenshot via Microlink API
 * Returns image Blob or null
 */
export async function captureFullPage(pageUrl) {
  const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(pageUrl)}&screenshot=true&screenshot.fullPage=true&meta=false`

  const res = await fetch(apiUrl)
  if (!res.ok) return null

  const json = await res.json()
  if (json.status !== 'success' || !json.data?.screenshot?.url) return null

  const imgRes = await fetch(json.data.screenshot.url)
  if (!imgRes.ok) return null

  return await imgRes.blob()
}

/**
 * Convert a Blob to a base64 data URL
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Slice a full-page image blob into vertical sections
 * Returns array of { label, data (base64 without prefix), type, preview (full data url) }
 */
export function sliceImage(blob, pageLabel = '/') {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const sections = []
      const total = Math.ceil(img.height / SECTION_HEIGHT)

      for (let i = 0; i < total; i++) {
        const canvas = document.createElement('canvas')
        const sliceH = Math.min(SECTION_HEIGHT, img.height - i * SECTION_HEIGHT)
        canvas.width = img.width
        canvas.height = sliceH

        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, i * SECTION_HEIGHT, img.width, sliceH, 0, 0, img.width, sliceH)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        sections.push({
          label: `${pageLabel} — section ${i + 1}/${total}`,
          data: dataUrl.split(',')[1],
          type: 'image/jpeg',
          preview: dataUrl,
        })
      }

      URL.revokeObjectURL(img.src)
      resolve(sections)
    }
    img.onerror = () => resolve([])
    img.src = URL.createObjectURL(blob)
  })
}

/**
 * Convert an uploaded File to the same section format
 */
export function fileToSection(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve({
        label: file.name,
        data: e.target.result.split(',')[1],
        type: file.type,
        preview: e.target.result,
      })
    }
    reader.readAsDataURL(file)
  })
}
