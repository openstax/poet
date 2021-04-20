import { Connection, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node'
import { BookBundle, BundleItem } from './book-bundle'
import { calculateElementPositions, expect, generateDiagnostic } from './utils'

export enum DiagnosticCode {
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

  private async processQueue(): Promise<void> {
    // This is slower than pop, but we shouldn't ever have more than a couple hundred items.
    // It's still sub-ms total to shift all the items in total
    const item = this.queue.shift()
    if (item === undefined) {
      return
    }
    const uri = expect(this.bundle.bundleItemToUri(item), 'item must be in bundle')
    if (item.type === 'collections') {
      const diagnostics = expect(await validateCollection(this.bundle, item.key), 'collection must be in bundle')
      this.connection.sendDiagnostics({
        uri,
        diagnostics
      })
    } else if (item.type === 'modules') {
      const diagnostics = expect(await validateModule(this.bundle, item.key), 'module must be in bundle')
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
      this.processQueue().catch(err => {
        this.errorEncountered = err
        this.connection.console.error('Error occured while processing validation queue')
      }).finally(() => {
        this.timer = undefined
        this.trigger()
      })
    }

    this.timer = setImmediate(processNext)
  }
}

export const validateCollection = async (bundle: BookBundle, filename: string): Promise<Diagnostic[] | null> => {
  const collectionExists = bundle.collectionExists(filename)
  if (!collectionExists) {
    return null
  }
  const allDiagnostics = (await Promise.all([
    validateCollectionModules(bundle, filename)
  ])).map(value => expect(value, 'collection must exist')).flat()
  return allDiagnostics
}

export const validateCollectionModules = async (bundle: BookBundle, filename: string): Promise<Diagnostic[] | null> => {
  const modulesUsed = await bundle.modulesUsed(filename)
  if (modulesUsed == null) {
    return null
  }
  const diagnostics = []
  for (const moduleLink of modulesUsed.inner) {
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

export const validateModule = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
  const moduleExists = bundle.moduleExists(moduleid)
  if (!moduleExists) {
    return null
  }
  const allDiagnostics = (await Promise.all([
    validateModuleImagePaths(bundle, moduleid),
    validateModuleLinks(bundle, moduleid)
  ])).map(value => expect(value, 'module must exist')).flat()
  return allDiagnostics
}

export const validateModuleImagePaths = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
  const imageSources = await bundle.moduleImageSources(moduleid)
  if (imageSources == null) {
    return null
  }
  const diagnostics = []
  for (const source of imageSources.inner) {
    if (source.inBundleMedia) {
      continue
    }
    const [startPosition, endPosition] = calculateElementPositions(source.element)
    const message = source.exists
      ? `Image file '${source.path}' exists, but not in the bundle media directory`
      : `Image file '${source.path}' does not exist`
    const diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      message,
      DiagnosticCode.ImagePath
    )
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

export const validateModuleLinks = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
  const links = await bundle.moduleLinks(moduleid)
  if (links == null) {
    return null
  }
  const diagnostics: Diagnostic[] = []
  for (const link of links.inner) {
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
    if (!(await bundle.isIdInModule(link.targetid, link.moduleid))) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' does not exist`)
      continue
    }
    if (!(await bundle.isIdUniqueInModule(link.targetid, link.moduleid))) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' is not unique`)
      continue
    }
  }
  return diagnostics
}
