import { Connection, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node'
import { BookBundle, BundleItem } from './book-bundle'
import { calculateElementPositions, expect, generateDiagnostic } from './utils'

export enum DiagnosticCode {
  Collection = 'Collection validation',
  ImagePath = 'Image validation',
  Link = 'Link validation'
}

export interface BundleValidationRequest {
  causeUri: string
}

export class BundleValidationQueue {
  private queue: BundleItem[] = []
  private timer: NodeJS.Immediate | undefined
  errorEncountered: Error | undefined

  constructor(private readonly bundle: BookBundle, private readonly connection: Connection) {}

  private clearQueue(): void {
    this.queue = []
  }

  addRequest(request?: BundleValidationRequest): void {
    this.clearQueue()
    if (request != null) {
      const priorityItem = this.bundle.bundleItemFromUri(request.causeUri)
      if ((priorityItem !== null) && (priorityItem.type === 'collections' || priorityItem.type === 'modules')) {
        this.queue.push(priorityItem)
      }
    }
    this.queue.push(...this.bundle.collectionItems())
    this.queue.push(...this.bundle.moduleItems())
    this.trigger()
  }

  private processQueue(): void {
    // This is slower than pop, but we shouldn't ever have more than a couple hundred items.
    // It's still sub-ms total to shift all the items in total
    const item = this.queue.shift()
    if (item === undefined) {
      return
    }
    const uri = expect(this.bundle.bundleItemToUri(item), 'item must be in bundle')
    if (item.type === 'collections') {
      const diagnostics = expect(validateCollection(this.bundle, item.key), 'collection must be in bundle')
      this.connection.sendDiagnostics({
        uri,
        diagnostics
      })
    } else if (item.type === 'modules') {
      const diagnostics = expect(validateModule(this.bundle, item.key), 'module must be in bundle')
      this.connection.sendDiagnostics({
        uri,
        diagnostics
      })
    } else {
      this.connection.console.error(`Ignoring unexpected item of type '${item.type}' and key ${item.key} in queue`)
    }
  }

  private trigger(): void {
    if (this.timer !== undefined || this.queue.length === 0) {
      // Either the queue is empty, or we're already set to process the next
      // entry
      return
    }

    const processNext = (): void => {
      try {
        this.processQueue()
      } catch(err) {
        this.errorEncountered = err
        this.connection.console.error('Error occured while processing validation queue')
      } finally {
        this.timer = undefined
        this.trigger()
      }
    }

    this.timer = setImmediate(processNext)
  }
}

export const collectionDiagnostic = (): Diagnostic[] => {
  return [generateDiagnostic(
    DiagnosticSeverity.Error,
    { line: 0, character: 0 },
    { line: 0, character: 0 },
    'Unable to parse collection, possibly missing "md:slug" or "md:title" tags',
    DiagnosticCode.Collection
  )]
}

export const validateCollection = (bundle: BookBundle, filename: string): Diagnostic[] | null => {
  const collectionExists = bundle.collectionExists(filename)
  if (!collectionExists) {
    return null
  }
  return expect(validateCollectionModules(bundle, filename), 'collection must exist')
}

export const validateCollectionModules = (bundle: BookBundle, filename: string): Diagnostic[] | null => {
  const modulesUsed = bundle.modulesUsed(filename)
  if (modulesUsed == null) {
    return null
  }
  const diagnostics = []
  for (const moduleLink of modulesUsed) {
    if (bundle.moduleExists(moduleLink.moduleid)) {
      continue
    }
    const [startPosition, endPosition] = calculateElementPositions(moduleLink.element)
    const message = `Cannot find linked module '${moduleLink.moduleid}'`
    const diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      message,
      DiagnosticCode.Link
    )
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

export const validateModule = (bundle: BookBundle, moduleid: string): Diagnostic[] | null => {
  const moduleExists = bundle.moduleExists(moduleid)
  if (!moduleExists) {
    return null
  }
  const allDiagnostics = [
    validateModuleImagePaths(bundle, moduleid),
    validateModuleLinks(bundle, moduleid)
  ].map(value => expect(value, 'module must exist')).flat()
  return allDiagnostics
}

export const validateModuleImagePaths = (bundle: BookBundle, moduleid: string): Diagnostic[] | null => {
  const imageSources = bundle.moduleImageSources(moduleid)
  if (imageSources == null) {
    return null
  }
  const diagnostics = []
  for (const source of imageSources) {
    if (source.inBundleMedia) {
      continue
    }
    const { startPos, endPos } = source
    const message = source.exists
      ? `Image file '${source.path}' exists, but not in the bundle media directory`
      : `Image file '${source.path}' does not exist`
    const diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPos,
      endPos,
      message,
      DiagnosticCode.ImagePath
    )
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

export const validateModuleLinks = (bundle: BookBundle, moduleid: string): Diagnostic[] | null => {
  const links = bundle.moduleLinks(moduleid)
  if (links == null) {
    return null
  }
  const diagnostics: Diagnostic[] = []
  for (const link of links) {
    const pushLinkDiagnostic = (message: string): void => {
      const [startPosition, endPosition] = calculateElementPositions(link.element)
      const diagnostic = generateDiagnostic(
        DiagnosticSeverity.Error,
        startPosition,
        endPosition,
        message,
        DiagnosticCode.Link
      )
      diagnostics.push(diagnostic)
    }
    if (!bundle.moduleExists(link.moduleid)) {
      pushLinkDiagnostic(`Target document '${link.moduleid}' for link cannot be found in the bundle`)
      continue
    }
    if (link.targetid == null) {
      continue
    }
    if (!(bundle.isIdInModule(link.targetid, link.moduleid))) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' does not exist`)
      continue
    }
    if (!(bundle.isIdUniqueInModule(link.targetid, link.moduleid))) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' is not unique`)
      continue
    }
  }
  return diagnostics
}
