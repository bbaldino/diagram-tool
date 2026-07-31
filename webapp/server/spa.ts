// The SPA fallback serves index.html for any GET that isn't a real static
// file, so client-side routes work on refresh. But backend paths must never
// fall through to index.html — they should 404 if unmatched. This guard marks
// the paths the fallback must skip.
export function isBackendPath(path: string): boolean {
  return path === '/mcp' || path.startsWith('/api/')
}
