const MAX_PAGES = 8

/**
 * Fetch HTML of a page via CORS proxy and extract internal links
 * Returns array of unique internal URLs (including the given URL)
 */
export async function discoverPages(baseUrl) {
  const cleanBase = baseUrl.replace(/\/$/, '')
  const pages = [cleanBase]

  try {
    // Try multiple CORS proxies as fallback
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(baseUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(baseUrl)}`,
    ]

    let html = null
    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        const data = await res.json?.() || await res.text()
        html = typeof data === 'string' ? data : data.contents
        if (html) break
      } catch { continue }
    }

    if (!html) return pages

    // Parse links
    const base = new URL(baseUrl)
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Prioritize nav/header/footer links (main navigation)
    const selectors = ['nav a[href]', 'header a[href]', '.menu a[href]', '.nav a[href]', 'a[href]']
    const found = new Set()
    found.add(cleanBase)

    for (const sel of selectors) {
      doc.querySelectorAll(sel).forEach((a) => {
        try {
          const href = a.getAttribute('href')
          if (!href) return
          if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return

          const resolved = new URL(href, baseUrl)
          if (resolved.hostname !== base.hostname) return
          if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|doc|xlsx|mp4|mp3)$/i.test(resolved.pathname)) return

          const clean = resolved.origin + resolved.pathname.replace(/\/$/, '')
          if (clean && !found.has(clean)) {
            found.add(clean)
          }
        } catch { /* skip invalid */ }
      })
    }

    return [...found].slice(0, MAX_PAGES)
  } catch {
    return pages
  }
}
