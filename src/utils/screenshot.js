const SECTION_HEIGHT = 900 // pixels per slice

/**
 * Capture a REAL full-page screenshot
 * Strategy: thum.io (free, no key, real full page) → Microlink fallback
 * Returns image Blob or null
 */
export async function captureFullPage(pageUrl, onStatus) {
  // Strategy 1: thum.io — true full-page capture
  onStatus?.('Capture full-page via thum.io...')
  const thumBlob = await tryThumIo(pageUrl)
  if (thumBlob && thumBlob.size > 5000) return thumBlob

  // Strategy 2: Microlink with fullPage
  onStatus?.('Capture via Microlink...')
  const microlinkBlob = await tryMicrolink(pageUrl)
  if (microlinkBlob && microlinkBlob.size > 5000) return microlinkBlob

  return null
}

async function tryThumIo(pageUrl) {
  try {
    // thum.io returns image directly, use proxy for CORS
    const thumUrl = `https://image.thum.io/get/fullpage/width/1280/noanimate/${pageUrl}`
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(thumUrl)}`

    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return null

    const blob = await res.blob()
    // Verify it's actually an image
    if (!blob.type.startsWith('image') && blob.size < 10000) return null
    return blob
  } catch {
    return null
  }
}

async function tryMicrolink(pageUrl) {
  try {
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(pageUrl)}&screenshot=true&screenshot.fullPage=true&meta=false`
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null

    const json = await res.json()
    if (json.status !== 'success' || !json.data?.screenshot?.url) return null

    const imgRes = await fetch(json.data.screenshot.url)
    if (!imgRes.ok) return null
    return await imgRes.blob()
  } catch {
    return null
  }
}

/**
 * For URLs where full-page fails, capture multiple viewport positions
 * Returns array of blobs at different scroll offsets
 */
export async function captureMultiViewport(pageUrl, viewportCount = 4) {
  const blobs = []
  for (let i = 0; i < viewportCount; i++) {
    const offset = i * 800
    try {
      // Use Microlink with scroll offset via URL hash trick
      const targetUrl = i === 0 ? pageUrl : pageUrl
      const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(targetUrl)}&screenshot=true&meta=false&viewport.height=900&screenshot.scrollTo.y=${offset}`
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue

      const json = await res.json()
      if (json.status !== 'success' || !json.data?.screenshot?.url) continue

      const imgRes = await fetch(json.data.screenshot.url)
      if (!imgRes.ok) continue
      blobs.push(await imgRes.blob())
    } catch {
      continue
    }
  }
  return blobs
}

/**
 * Slice a full-page image blob into vertical sections
 * Returns array of { label, data, type, preview }
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
 * Convert a blob directly to a section (for multi-viewport captures)
 */
export function blobToSection(blob, label) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve({
        label,
        data: e.target.result.split(',')[1],
        type: blob.type || 'image/jpeg',
        preview: e.target.result,
      })
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert an uploaded File to section format
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
