import { v4 as uuidv4 } from 'uuid'

// Bare uuid v4. Uses the uuid lib (getRandomValues-based) so it works in a
// non-secure browser context (plain-HTTP LAN) — unlike crypto.randomUUID().
export function newId(): string {
  return uuidv4()
}
