export type MenuItem = {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  separatorBefore?: boolean
  submenu?: MenuItem[]
}

export function firstEnabledIndex(items: MenuItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (!items[i].disabled) {
      return i
    }
  }
  return -1
}

export function lastEnabledIndex(items: MenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].disabled) {
      return i
    }
  }
  return -1
}

export function moveMenuHighlight(items: MenuItem[], current: number, delta: 1 | -1): number {
  // Get all enabled indices
  const enabledIndices: number[] = []
  for (let i = 0; i < items.length; i++) {
    if (!items[i].disabled) {
      enabledIndices.push(i)
    }
  }

  // If no enabled items, return -1
  if (enabledIndices.length === 0) {
    return -1
  }

  // Handle -1 as special case: before-first for +1, after-last for -1
  if (current === -1) {
    if (delta === 1) {
      return enabledIndices[0]
    } else {
      return enabledIndices[enabledIndices.length - 1]
    }
  }

  // Find current position in enabled indices
  const currentPos = enabledIndices.indexOf(current)

  // Calculate new position with wrapping
  let newPos = currentPos + delta
  if (newPos < 0) {
    newPos = enabledIndices.length - 1
  } else if (newPos >= enabledIndices.length) {
    newPos = 0
  }

  return enabledIndices[newPos]
}
