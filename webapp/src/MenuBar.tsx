import { useCallback, useEffect, useRef, useState } from 'react'
import {
  firstEnabledIndex,
  lastEnabledIndex,
  moveMenuHighlight,
  type MenuItem,
} from './menuNav'

type MenuId = 'file' | 'edit' | 'view' | 'arrange'

type MenuDef = { id: MenuId; title: string; items: MenuItem[] }

type SaveState = { label: string; kind: 'saved' | 'saving' | 'error' }

const SAVE_ICON: Record<SaveState['kind'], string> = {
  saved: '✓',
  saving: '○',
  error: '!',
}

// Value shown inline for a submenu-parent row, e.g. "Auto-layout ▸ Graphviz" —
// the current selection is whichever child item is checked.
function submenuValueLabel(item: MenuItem): string | null {
  const current = item.submenu?.find((c) => c.checked)
  return current ? current.label : null
}

export function MenuBar({
  menus,
  onItem,
  saveState,
}: {
  menus: MenuDef[]
  onItem: (menuId: string, itemId: string) => void
  saveState: SaveState
}) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)
  const [subHighlight, setSubHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<number | null>(null)

  const activeMenu = menus.find((m) => m.id === openMenu) ?? null
  const items = activeMenu?.items ?? []
  const submenuItem = openSubmenu != null ? items[openSubmenu] : undefined
  const submenuItems = submenuItem?.submenu ?? []

  const closeAll = useCallback(() => {
    setOpenMenu(null)
    setHighlight(-1)
    setOpenSubmenu(null)
    setSubHighlight(-1)
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const closeSubmenu = useCallback(() => {
    setOpenSubmenu(null)
    setSubHighlight(-1)
  }, [])

  // Outside-click dismiss. Capture phase: React Flow's pane runs d3-zoom,
  // which calls stopImmediatePropagation() on the pane's mousedown, so a
  // bubble-phase listener never sees clicks on the canvas. Capturing runs
  // before d3 can stop the event (mirrors CanvasAddMenu / App.tsx's addMenu
  // dismiss pattern).
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeAll()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [openMenu, closeAll])

  // Keyboard navigation while a menu is open.
  useEffect(() => {
    if (!openMenu || !activeMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (openSubmenu != null) closeSubmenu()
        else closeAll()
        return
      }
      if (openSubmenu != null) {
        // Navigating within the open submenu.
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSubHighlight((h) => moveMenuHighlight(submenuItems, h, 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSubHighlight((h) => moveMenuHighlight(submenuItems, h, -1))
        } else if (e.key === 'Home') {
          e.preventDefault()
          setSubHighlight(firstEnabledIndex(submenuItems))
        } else if (e.key === 'End') {
          e.preventDefault()
          setSubHighlight(lastEnabledIndex(submenuItems))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          closeSubmenu()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const item = submenuItems[subHighlight]
          if (item && !item.disabled) {
            onItem(activeMenu.id, item.id)
            closeAll()
          }
        }
        return
      }
      // Navigating within the top-level menu.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => moveMenuHighlight(items, h, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => moveMenuHighlight(items, h, -1))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setHighlight(firstEnabledIndex(items))
      } else if (e.key === 'End') {
        e.preventDefault()
        setHighlight(lastEnabledIndex(items))
      } else if (e.key === 'ArrowRight') {
        const item = items[highlight]
        if (item?.submenu && !item.disabled) {
          e.preventDefault()
          setOpenSubmenu(highlight)
          setSubHighlight(firstEnabledIndex(item.submenu))
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = items[highlight]
        if (item && !item.disabled) {
          if (item.submenu) {
            setOpenSubmenu(highlight)
            setSubHighlight(firstEnabledIndex(item.submenu))
          } else {
            onItem(activeMenu.id, item.id)
            closeAll()
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    openMenu,
    activeMenu,
    items,
    highlight,
    openSubmenu,
    submenuItems,
    subHighlight,
    onItem,
    closeAll,
    closeSubmenu,
  ])

  useEffect(() => {
    return () => {
      if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current)
    }
  }, [])

  const handleTitleClick = (id: MenuId) => {
    setOpenMenu((prev) => (prev === id ? null : id))
    setHighlight(-1)
    setOpenSubmenu(null)
    setSubHighlight(-1)
  }

  const handleTitleMouseEnter = (id: MenuId) => {
    if (openMenu && openMenu !== id) {
      setOpenMenu(id)
      setHighlight(-1)
      setOpenSubmenu(null)
      setSubHighlight(-1)
    }
  }

  const handleItemClick = (index: number, item: MenuItem) => {
    if (item.disabled || !activeMenu) return
    if (item.submenu) {
      setHighlight(index)
      setOpenSubmenu(index)
      setSubHighlight(firstEnabledIndex(item.submenu))
    } else {
      onItem(activeMenu.id, item.id)
      closeAll()
    }
  }

  const handleItemMouseEnter = (index: number, item: MenuItem) => {
    setHighlight(index)
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (item.disabled) return
    if (item.submenu) {
      hoverTimer.current = window.setTimeout(() => {
        setOpenSubmenu(index)
        setSubHighlight(-1)
      }, 120)
    } else if (openSubmenu != null) {
      closeSubmenu()
    }
  }

  const handleSubItemClick = (item: MenuItem) => {
    if (item.disabled || !activeMenu) return
    onItem(activeMenu.id, item.id)
    closeAll()
  }

  const renderItemContent = (item: MenuItem) => (
    <>
      {item.checked !== undefined && (
        <span className="menu__check">{item.checked ? '✓' : ''}</span>
      )}
      <span className="menu__label">
        {item.label}
        {item.submenu && submenuValueLabel(item) ? ` ▸ ${submenuValueLabel(item)}` : ''}
      </span>
      {item.submenu ? (
        <span className="menu__arrow">›</span>
      ) : item.shortcut ? (
        <span className="menu__shortcut">{item.shortcut}</span>
      ) : null}
    </>
  )

  return (
    <div className="menubar" ref={rootRef}>
      <div className="menubar__left">
        <span className="menubar__brand" />
        <span className="menubar__word">Diagram</span>
        <div className="menubar__titles">
          {menus.map((menu) => (
            <div key={menu.id} className="menubar__titlewrap">
              <div
                className={`menubar__title${openMenu === menu.id ? ' is-open' : ''}`}
                onClick={() => handleTitleClick(menu.id)}
                onMouseEnter={() => handleTitleMouseEnter(menu.id)}
              >
                {menu.title}
              </div>
              {openMenu === menu.id && (
                <div className="menu" role="menu">
                  {menu.items.map((item, i) => (
                    <div key={item.id} style={{ position: 'relative' }}>
                      {item.separatorBefore && <div className="menu__sep" />}
                      <div
                        className={[
                          'menu__item',
                          item.submenu ? 'menu__submenu-parent' : '',
                          i === highlight ? 'is-active' : '',
                          item.disabled ? 'is-disabled' : '',
                          item.danger ? 'is-danger' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => handleItemClick(i, item)}
                        onMouseEnter={() => handleItemMouseEnter(i, item)}
                      >
                        {renderItemContent(item)}
                      </div>
                      {openSubmenu === i && (
                        <div className="menu__submenu" role="menu">
                          {submenuItems.map((subItem, j) => (
                            <div key={subItem.id}>
                              {subItem.separatorBefore && <div className="menu__sep" />}
                              <div
                                className={[
                                  'menu__item',
                                  j === subHighlight ? 'is-active' : '',
                                  subItem.disabled ? 'is-disabled' : '',
                                  subItem.danger ? 'is-danger' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                onClick={() => handleSubItemClick(subItem)}
                                onMouseEnter={() => setSubHighlight(j)}
                              >
                                {renderItemContent(subItem)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div
        className={`menubar__save menubar__save--${saveState.kind}`}
        onClick={saveState.kind === 'error' ? () => onItem('_save', 'retry') : undefined}
      >
        <span className="menubar__save-ico">{SAVE_ICON[saveState.kind]}</span>
        <span className="menubar__save-text">{saveState.label}</span>
      </div>
    </div>
  )
}
