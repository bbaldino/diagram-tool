const METADATA_URL = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json'

export interface IconEntry {
  slug: string
  aliases: string[]
  categories: string[]
}

// The metadata.json shape (only the fields we use). Keyed by slug.
interface RawMeta {
  [slug: string]: { base?: string; aliases?: string[]; categories?: string[] } | undefined
}

// The app renders `${ICON_BASE}/<slug>.svg`, so only offer icons available as
// SVG (a few entries are png-only). Sorted by slug for stable ordering.
export function buildIndex(meta: RawMeta): IconEntry[] {
  const out: IconEntry[] = []
  for (const [slug, v] of Object.entries(meta)) {
    if (!v || v.base !== 'svg') continue
    out.push({ slug, aliases: v.aliases ?? [], categories: v.categories ?? [] })
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  return out
}

// Ranked filter: slug-prefix, then alias-prefix, then substring (slug or alias);
// stable by slug within a tier; capped at `limit`. Empty query → [].
export function searchIcons(index: IconEntry[], query: string, limit = 10): IconEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { e: IconEntry; tier: number }[] = []
  for (const e of index) {
    const slug = e.slug.toLowerCase()
    const aliases = e.aliases.map((a) => a.toLowerCase())
    let tier = -1
    if (slug.startsWith(q)) tier = 0
    else if (aliases.some((a) => a.startsWith(q))) tier = 1
    else if (slug.includes(q) || aliases.some((a) => a.includes(q))) tier = 2
    if (tier >= 0) scored.push({ e, tier })
  }
  scored.sort((a, b) => a.tier - b.tier || (a.e.slug < b.e.slug ? -1 : a.e.slug > b.e.slug ? 1 : 0))
  return scored.slice(0, limit).map((s) => s.e)
}

// Wrapping cursor math for keyboard nav. current = -1 means nothing highlighted.
export function moveHighlight(current: number, count: number, delta: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}

let cache: IconEntry[] | null = null
let inflight: Promise<IconEntry[]> | null = null

// Fetch the dashboard-icons metadata ONCE, cache the built index, and dedupe
// concurrent calls. On any failure, resolve to [] so the input degrades to a
// plain free-text field (the icons themselves already depend on this CDN).
export async function loadIconIndex(): Promise<IconEntry[]> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(METADATA_URL)
      if (!res.ok) throw new Error(`metadata ${res.status}`)
      cache = buildIndex((await res.json()) as RawMeta)
      return cache
    } catch {
      return []
    } finally {
      inflight = null
    }
  })()
  return inflight
}
