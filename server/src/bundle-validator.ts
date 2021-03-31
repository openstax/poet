import { Connection, Diagnostic, DiagnosticSeverity, PublishDiagnosticsParams } from "vscode-languageserver/node"
import { BookBundle, BundleItem } from "./book-bundle"
import { calculateElementPositions, expect, generateDiagnostic } from './utils'

enum DiagnosticSource {
  ImagePath = 'Image validation',
  Link = 'Link validation'
}

export interface BundleValidationRequest {
  causeUri: string
}

export class BundleValidationQueue {
  private queue: BundleItem[] = []
  private timer: NodeJS.Immediate | undefined

  constructor(private bundle: BookBundle, private connection: Connection) {}

  private clearQueue(): void {
    this.queue = []
  }
  
  addRequest(request: BundleValidationRequest): void {
    this.clearQueue()
    const priorityItem = expect(this.bundle.bundleItemFromUri(request.causeUri), 'caller must verify uri resides in this bundle')
    this.queue.push(priorityItem)
    this.queue.push(...this.bundle.collectionItems())
    this.queue.push(...this.bundle.moduleItems())
    this.trigger()
  }

  private async processQueue(): Promise<void> {
    const item = this.queue.shift()
    if (item === undefined) {
      return
    }

    const uri = expect(this.bundle.bundleItemToUri(item), 'item must be in bundle')
    if (item.type === 'collections') {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: expect(await validateCollection(this.bundle, item.key), 'collection must be in bundle')
      })
    } else if (item.type === 'modules') {
      this.connection.sendDiagnostics({
        uri,
        diagnostics: expect(await validateModule(this.bundle, item.key), 'module must be in bundle')
      })
    } else {
      throw new Error(`Unexpected item of type '${item.type}' and key ${item.key} in queue`)
    }
  }

  private trigger(): void {
    if (this.timer !== undefined || this.queue.length === 0) {
      // Either the queue is empty, or we're already set to process the next
      // entry
      return
    }

    this.timer = setImmediate(() => {
      this.processQueue().finally(() => {
        this.timer = undefined
        this.trigger()
      })
    })
  }
}

const validateCollection = async (bundle: BookBundle, filename: string): Promise<Diagnostic[] | null> => {
  const collectionExists = bundle.collectionExists(filename)
  if (!collectionExists) {
    return null
  }
  const allDiagnostics = (await Promise.all([
    validateCollectionModules(bundle, filename)
  ])).map(value => expect(value, 'collection must exist')).flat()
  return allDiagnostics
}

const validateCollectionModules = async (bundle: BookBundle, filename: string): Promise<Diagnostic[] | null> => {
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
      DiagnosticSource.Link
    )
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

const validateModule = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
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

const validateModuleImagePaths = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
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
      ? `Image file '${source}' exists, but not in the bundle media folder`
      : `Image file '${source}' does not exist`
    const diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      message,
      DiagnosticSource.ImagePath
    )
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

const validateModuleLinks = async (bundle: BookBundle, moduleid: string): Promise<Diagnostic[] | null> => {
  const links = await bundle.moduleLinks(moduleid)
  if (links == null) {
    return null
  }
  const diagnostics: Diagnostic[] = []
  for (const link of links.inner) {
    const pushLinkDiagnostic = (message: string) => {
      const [startPosition, endPosition] = calculateElementPositions(link.element)
      const diagnostic = generateDiagnostic(
        DiagnosticSeverity.Error,
        startPosition,
        endPosition,
        message,
        DiagnosticSource.Link
      )
      diagnostics.push(diagnostic)
    }
    if (!bundle.moduleExists(link.moduleid)) {
      pushLinkDiagnostic(`Target document '${link.moduleid}' for link cannot be found in the bundle`)
      continue
    }
    if (!bundle.isIdInModule(link.targetid, link.moduleid)) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' does not exist`)
      continue
    }
    if (!bundle.isIdUniqueInModule(link.targetid, link.moduleid)) {
      pushLinkDiagnostic(`Target ID '${link.targetid}' in document '${link.moduleid}' is not unique`)
      continue
    }
  }
  return diagnostics
}
