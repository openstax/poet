import fs from 'fs'
import path from 'path'
import I from 'immutable'

export interface Dirent {
  readonly name: string
  readonly path: string
  readonly realpath: string
  /**
   * Returns true if a path is a directory or a symbolic link pointing to a directory
   */
  readonly isDirectory: () => boolean
  readonly isFile: () => boolean
  readonly isSymbolicLink: () => boolean
}

export interface Walker {
  readonly readdir: (dir: string) => Dirent[]
  readonly shouldWalk: (dirent: Dirent) => boolean
  readonly onError: (err: Error) => void
}

export const followSymbolicLinks = () => {
  let visited = I.Set()
  return (dirent: Dirent) => {
    if (dirent.isDirectory()) {
      const p = dirent.realpath
      if (!visited.has(p)) {
        visited = visited.add(p)
        return true
      }
    }
    return false
  }
}

export function * walkDir(
  walker: Walker,
  start: string
): Generator<Dirent, void, unknown> {
  const toVisit = [start]
  let next: string | undefined
  while ((next = toVisit.shift()) !== undefined) {
    try {
      const entries = walker.readdir(next)
      for (const entry of entries) {
        if (walker.shouldWalk(entry)) {
          toVisit.push(entry.path)
        }
        yield entry
      }
    } catch (e) {
      walker.onError(e as Error)
    }
  }
}

// Most implementations of dirent use d_type which ORs together types like
// dt_type = DT_DIR | DT_LNK and then isDirectory() would return
// (dt_type & DT_DIR) == DT_DIR
// For whatever reason, node's FS implementation is different. This
// adaptation addresses that difference
export const adaptFSDirent = (
  wd: string, realpath: (p: string) => string, dirent: fs.Dirent
): Dirent => ({
  name: dirent.name,
  get path() { return path.join(wd, dirent.name) },
  get realpath() { return realpath(this.path) },
  isDirectory() {
    return dirent.isDirectory() || (
      dirent.isSymbolicLink() && isDirectorySync(this.path)
    )
  },
  isFile() {
    return dirent.isFile() || (
      dirent.isSymbolicLink() && isFileSync(this.path)
    )
  },
  isSymbolicLink: dirent.isSymbolicLink.bind(dirent)
})

export const readdirSync = (wd: string) => {
  return fs
    .readdirSync(wd, { withFileTypes: true })
    .map((dirent) => adaptFSDirent(wd, fs.realpathSync, dirent))
}

export const isDirectorySync = (p: string) => {
  try {
    const stat = fs.statSync(p)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export const isFileSync = (p: string) => {
  try {
    const stat = fs.statSync(p)
    return stat.isFile()
  } catch {
    return false
  }
}
