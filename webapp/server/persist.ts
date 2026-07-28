import { writeFile, rename } from 'node:fs/promises'

let counter = 0

// Atomically replace a file's contents: write to a unique temp sibling, then
// rename it over the target. rename(2) is atomic on POSIX, so a reader — or a
// crash/restart landing mid-write — never observes a torn, half-written file;
// it sees either the complete previous version or the complete new one. This is
// what keeps history.json (and model.json) from being corrupted when a dev-server
// restart interrupts a write.
export async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${counter++}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}
