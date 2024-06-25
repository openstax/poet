import { expect, beforeEach, jest } from '@jest/globals'
import { type Dirent, type Walker, followSymbolicLinks, walkDir, adaptFSDirent, isDirectorySync, isFileSync } from './fs-utils'
import { expectValue } from './model/utils'
import { type Dirent as FSDirent } from 'fs'
import SinonRoot from 'sinon'
import { Substitute } from '@fluffy-spoon/substitute'
import path from 'path'
import mockfs from 'mock-fs'

let iota = 0

enum EntryType {
  File = 1 << iota++,
  Directory = 1 << iota++,
  SymbolicLink = 1 << iota++
}

describe('FS Utils', () => {
  const sinon = SinonRoot.createSandbox()
  afterEach(() => {
    sinon.restore()
  })
  describe('walkDir', () => {
    let mockFS: Record<string, Dirent>
    const createEntry = (
      path: string, type: EntryType, realpath: (p: string) => string
    ): Dirent => {
      const name = path.split('/').slice(-1)[0]
      return {
        name,
        path,
        get realpath() { return realpath(this.path) },
        isFile: jest.fn<() => boolean>().mockReturnValue((type & EntryType.File) === EntryType.File),
        isDirectory: jest.fn<() => boolean>().mockReturnValue((type & EntryType.Directory) === EntryType.Directory),
        isSymbolicLink: jest.fn<() => boolean>().mockReturnValue((type & EntryType.SymbolicLink) === EntryType.SymbolicLink)
      }
    }
    const getOrAddEntry = (
      path: string, type: EntryType, realpath = (p: string) => p
    ) => {
      if (!(path in mockFS)) {
        const entry = createEntry(path, type, realpath)
        mockFS[path] = entry
      }
      return expectValue(mockFS[path], path)
    }
    const getEntry = (path: string): Dirent | undefined => mockFS[path]
    beforeEach(() => {
      mockFS = Object.create(null)
    })
    it('walks regular directories', () => {
      const walker: Walker = {
        readdir: (dir) => Object.values(mockFS).filter((v) =>
          v.path !== dir && v.path.split('/').slice(0, -1).join('/') === dir
        ),
        shouldWalk: (dirent) => dirent.isDirectory(),
        onError: (err) => { throw err }
      }
      const entries = [
        getOrAddEntry('/a.txt', EntryType.File),
        getOrAddEntry('/dir1', EntryType.Directory),
        getOrAddEntry('/dir1/b.txt', EntryType.File)
      ]
      const result = Array.from(walkDir(walker, ''))
      entries.forEach((e) => {
        expect(e.isDirectory).toHaveBeenCalled()
      })
      expect(result).toStrictEqual(entries)
    })
    it('can handle symbolic links', () => {
      const symlinkMap: Record<string, string> = {
        '/dir1/dir2': '/dir1',
        '/b.txt': '/a.txt',
        '/dir1/dir2/dir3': '/dir1'
      }
      const realpath = (p: string) => (p in symlinkMap) ? symlinkMap[p] : p
      const { File, Directory, SymbolicLink } = EntryType
      getOrAddEntry('/a.txt', File, realpath)
      getOrAddEntry('/b.txt', SymbolicLink | File, realpath)
      getOrAddEntry('/dir1', Directory, realpath)
      getOrAddEntry('/dir1/something.txt', File, realpath)
      getOrAddEntry('/dir1/something2.txt', File, realpath)
      getOrAddEntry('/dir1/dir2', SymbolicLink | Directory, realpath)
      getOrAddEntry('/dir1/dir2/dir3', SymbolicLink | Directory, realpath)
      getOrAddEntry('/dir1/dir2/something.txt', SymbolicLink | File, realpath)
      getOrAddEntry('/dir1/dir2/something2.txt', SymbolicLink | File, realpath)
      const shouldWalk = followSymbolicLinks()
      const walker: Walker = {
        readdir: (dir) => Object.values(mockFS).filter((v) =>
          v.path !== dir && v.path.split('/').slice(0, -1).join('/') === dir
        ),
        shouldWalk,
        onError: (err) => { throw err }
      }
      const results = Array.from(walkDir(walker, ''))
      // It should not yield the contents of dir2 because dir2 is dir1, which
      // was already visited
      const expectedResults = [
        getEntry('/a.txt'),
        getEntry('/b.txt'),
        getEntry('/dir1'),
        getEntry('/dir1/something.txt'),
        getEntry('/dir1/something2.txt'),
        getEntry('/dir1/dir2')
      ]
      expect(results).toStrictEqual(expectedResults)
    })
    it('handles errors correctly', () => {
      const onErrorStub = jest.fn<() => void>()
      const readdirStub = jest.fn<(wd: string) => Dirent[]>().mockImplementation(() => {
        throw new Error('My readdir error message')
      })
      getOrAddEntry('/a.txt', EntryType.File)
      const walker: Walker = {
        readdir: readdirStub,
        shouldWalk: (dirent) => dirent.isDirectory(),
        onError: onErrorStub
      }
      expect(Array.from(walkDir(walker, '/'))).toStrictEqual([])
      expect(readdirStub).toHaveBeenCalled()
      expect(onErrorStub).toHaveBeenCalled()
    })
  })
  describe('file system tests', () => {
    const mockFileName = 'file-that-does-exist'
    const mockDirName = 'directory-that-does-exist'
    beforeEach(() => {
      mockfs({
        [mockFileName]: '',
        [mockDirName]: {}
      })
    })
    afterEach(() => {
      mockfs.restore()
    })
    it('adaptFSDirent adapts fs dirents correctly', () => {
      const mock = {
        name: 'test',
        isFile: jest.fn<() => boolean>(),
        isDirectory: jest.fn<() => boolean>(),
        isSymbolicLink: jest.fn<() => boolean>()
      }
      const fakeFSDirent = new Proxy(Substitute.for<FSDirent>(), {
        get: (target, p) => Reflect.get(mock, p) ?? Reflect.get(target, p)
      })
      const fakePath = 'fs-utils.spec.ts-fake-dir-for-test'
      const adapted = adaptFSDirent(fakePath, (p) => `realpath-${p}`, fakeFSDirent)
      expect(adapted.path).toBe(path.join(fakePath, mock.name))
      expect(adapted.realpath).toBe(path.join(`realpath-${fakePath}`, mock.name))

      // Ensure everything is adapted correctly
      expect(mock.isFile).not.toHaveBeenCalled()
      adapted.isFile()
      expect(mock.isFile).toHaveBeenCalled()
      expect(mock.isSymbolicLink).toHaveBeenCalledTimes(1)

      adapted.isSymbolicLink()
      expect(mock.isSymbolicLink).toHaveBeenCalledTimes(2)

      expect(mock.isDirectory).not.toHaveBeenCalled()
      adapted.isDirectory()
      expect(mock.isDirectory).toHaveBeenCalled()
      expect(mock.isSymbolicLink).toHaveBeenCalledTimes(3)

      mock.isDirectory.mockReset()
      mock.isDirectory.mockReturnValue(false)
      mock.isSymbolicLink.mockReset()
      mock.isSymbolicLink.mockReturnValue(true)
      // When a path does not exist, isDirectorySync returns `false`
      expect(isDirectorySync(fakePath)).toBe(false)
      expect(adapted.isDirectory()).toBe(false)
      expect(mock.isDirectory).toBeCalledTimes(1)
      expect(mock.isSymbolicLink).toBeCalledTimes(1)

      mock.isFile.mockReset()
      mock.isFile.mockReturnValue(false)
      mock.isSymbolicLink.mockReset()
      mock.isSymbolicLink.mockReturnValue(true)
      // When a path does not exist, isFileSync returns `false`
      expect(isFileSync(fakePath)).toBe(false)
      expect(adapted.isFile()).toBe(false)
      expect(mock.isFile).toBeCalledTimes(1)
      expect(mock.isSymbolicLink).toBeCalledTimes(1)
    })
    it('checks type', () => {
      expect(isFileSync(mockFileName)).toBe(true)
      expect(isDirectorySync(mockDirName)).toBe(true)
      expect(isFileSync('not-existing-file')).toBe(false)
      expect(isDirectorySync('not-existing-dir')).toBe(false)
    })
  })
})
