import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildIndex, searchIcons, moveHighlight, type IconEntry } from './iconIndex'

const fixture: IconEntry[] = [
  { slug: 'plex', aliases: ['plexmediaserver'], categories: ['media'] },
  { slug: 'plexamp', aliases: [], categories: ['media'] },
  { slug: 'sonarr', aliases: [], categories: ['media'] },
  { slug: 'complex-thing', aliases: ['xplex'], categories: [] },
  { slug: 'radarr', aliases: ['movies'], categories: ['media'] },
]

describe('buildIndex', () => {
  it('keeps only svg-based icons and sorts by slug', () => {
    const out = buildIndex({
      zulip: { base: 'svg', aliases: ['chat'], categories: ['comm'] },
      apple: { base: 'png', aliases: [] }, // png-only → dropped (app renders .svg)
      arch: { base: 'svg' },
    })
    expect(out.map((e) => e.slug)).toEqual(['arch', 'zulip'])
    expect(out[0]).toEqual({ slug: 'arch', aliases: [], categories: [] })
    expect(out[1].aliases).toEqual(['chat'])
  })
})

describe('searchIcons', () => {
  it('returns [] for an empty/whitespace query', () => {
    expect(searchIcons(fixture, '')).toEqual([])
    expect(searchIcons(fixture, '   ')).toEqual([])
  })
  it('ranks slug-prefix, then alias-prefix, then substring; stable by slug', () => {
    // 'plex': slug-prefix plex, plexamp; substring complex-thing (slug) + plex(alias already counted)
    expect(searchIcons(fixture, 'plex').map((e) => e.slug)).toEqual([
      'plex',
      'plexamp',
      'complex-thing',
    ])
  })
  it('surfaces an icon via an alias-prefix match', () => {
    expect(searchIcons(fixture, 'movies').map((e) => e.slug)).toEqual(['radarr'])
  })
  it('is case-insensitive and respects the limit', () => {
    expect(searchIcons(fixture, 'PLEX').map((e) => e.slug)).toEqual([
      'plex',
      'plexamp',
      'complex-thing',
    ])
    expect(searchIcons(fixture, 'a', 1)).toHaveLength(1)
  })
})

describe('moveHighlight', () => {
  it('wraps and handles the none-selected (-1) and empty cases', () => {
    expect(moveHighlight(-1, 3, +1)).toBe(0)
    expect(moveHighlight(-1, 3, -1)).toBe(2)
    expect(moveHighlight(2, 3, +1)).toBe(0)
    expect(moveHighlight(0, 3, -1)).toBe(2)
    expect(moveHighlight(0, 0, +1)).toBe(-1)
  })
})

describe('loadIconIndex', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches once and caches across calls', async () => {
    const mod = await import('./iconIndex')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ plex: { base: 'svg', aliases: [], categories: [] } }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const a = await mod.loadIconIndex()
    const b = await mod.loadIconIndex()
    expect(a.map((e) => e.slug)).toEqual(['plex'])
    expect(b).toBe(a) // same cached array
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] on fetch failure without throwing', async () => {
    const mod = await import('./iconIndex')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
    )
    await expect(mod.loadIconIndex()).resolves.toEqual([])
  })
})
