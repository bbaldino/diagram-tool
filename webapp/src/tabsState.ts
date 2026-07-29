export function addTab(openTabs: string[], id: string): string[] {
  if (openTabs.includes(id)) {
    return openTabs
  }
  return [...openTabs, id]
}

export function sanitizeOpenTabs(
  openTabs: string[],
  diagramIds: string[],
  activeId: string | null
): string[] {
  const known = new Set(diagramIds)
  const seen = new Set<string>()
  const result: string[] = []

  // Filter to known and dedupe, preserving order
  for (const id of openTabs) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }

  // If activeId is a real diagram id and not in result, append it
  if (activeId && known.has(activeId) && !result.includes(activeId)) {
    result.push(activeId)
  }

  return result
}

export function closeTab(
  openTabs: string[],
  activeId: string | null,
  closeId: string
): { openTabs: string[]; activeId: string | null } {
  const idx = openTabs.indexOf(closeId)
  const next = openTabs.filter((id) => id !== closeId)

  if (closeId !== activeId) {
    return { openTabs: next, activeId }
  }

  // closeId was the active tab, pick a neighbor
  const newActive = next[idx - 1] ?? next[idx] ?? null
  return { openTabs: next, activeId: newActive }
}
