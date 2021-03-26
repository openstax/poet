import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  WorkspaceFolder,
  Connection
} from 'vscode-languageserver/node'
import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import { DOMParser } from 'xmldom'
import * as xpath from 'xpath-ts'
import {
  URI
} from 'vscode-uri'
import fs from 'fs'
import path from 'path'
import glob from 'glob'

const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const IMAGEPATH_DIAGNOSTIC_SOURCE = 'Image validation'
export const LINK_DIAGNOSTIC_SOURCE = 'Link validation'

export function parseXMLString(textDocument: TextDocument): Document | null {
  const text = textDocument.getText()
  const xmlData: Document = new DOMParser().parseFromString(text)
  if (xmlData === undefined) {
    return null
  }
  return xmlData
}

export async function validateImagePaths(textDocument: TextDocument, xmlData: Document): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []

  const select = xpath.useNamespaces({ cnxml: NS_CNXML })
  const images = select('//cnxml:image[@src]', xmlData) as Node[]

  for (const image of images) {
    const imageElement = image as any
    const imageSrc = imageElement.getAttribute('src')
    if (imageSrc === '') {
      continue
    }

    const documentPath = URI.parse(textDocument.uri).path
    // The image path is relative to the document
    const imagePath = path.join(path.dirname(documentPath), imageSrc)
    // Track the location of the image path in the text for diagnostic range
    const [startPosition, endPosition] = calculateElementPositions(imageElement)

    if (fs.existsSync(imagePath)) {
      continue
    }
    const diagnostic: Diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      `Image file ${String(imageSrc)} doesn't exist!`,
      IMAGEPATH_DIAGNOSTIC_SOURCE
    )
    diagnostics.push(diagnostic)
  }

  return diagnostics
}

export async function validateLinks(xmlData: Document, knownModules: Map<string, ModuleInformation>): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []

  const samePageValidation = validateSamePageLinks(xmlData)
  const otherPageValidation = validateOtherPageLinks(xmlData, knownModules)
  await Promise.all([samePageValidation, otherPageValidation]).then(results => {
    results.forEach(diags => diagnostics.push(...diags))
  })

  return diagnostics
}

export interface ModuleInformation {
  path: string
}

export async function getCurrentModules(workspaceFolders: WorkspaceFolder[]): Promise<Map<string, ModuleInformation>> {
  const moduleFiles = new Map<string, ModuleInformation>()

  for (const workspace of workspaceFolders) {
    const modulesPath = path.join(URI.parse(workspace.uri).path, 'modules')
    if (fs.existsSync(modulesPath)) {
      // Return modules with full path information in case we need to peek into
      // any of them later (e.g. for validation purposes)
      glob.sync('**/*.cnxml', { cwd: modulesPath }).forEach(val => {
        const modulePath = modulesPath.concat('/', val)
        const moduleId = val.split('/')[0]
        const moduleInformation: ModuleInformation = {
          path: modulePath
        }
        moduleFiles.set(moduleId, moduleInformation)
      })
    }
  }

  return moduleFiles
}

async function validateOtherPageLinks(xmlData: Document, knownModules: Map<string, ModuleInformation>): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const select = xpath.useNamespaces({ cnxml: NS_CNXML })
  const documentLinks = select('//cnxml:link[@document]', xmlData) as Node[]
  const parsedOtherPages = new Map<string, Document>()

  for (const link of documentLinks) {
    const linkElement = link as any
    const linkTargetModule: string = linkElement.getAttribute('document')
    const [startPosition, endPosition] = calculateElementPositions(linkElement)
    const preparedDiagnostic: Diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      '',
      LINK_DIAGNOSTIC_SOURCE
    )

    if (linkTargetModule === '') {
      continue
    }

    // Check whether the target module is known
    const targetModuleInformation = knownModules.get(linkTargetModule)
    if (targetModuleInformation === undefined) {
      preparedDiagnostic.message = `Target document for link doesn't exist!: ${linkTargetModule}`
      diagnostics.push(preparedDiagnostic)
      continue
    }

    // A matching module was found. Also validate target ID if it's specified in the link
    const linkTargetId: string = linkElement.getAttribute('target-id')
    if (linkTargetId !== '') {
      // Grab a previously parsed object if we've already checked something on
      // this target page, otherwise read the file and parse it
      let maybeModuleXmlData: Document | undefined = parsedOtherPages.get(linkTargetModule)
      if (maybeModuleXmlData === undefined) {
        const targetModulePath = targetModuleInformation.path
        const targetModuleText = fs.readFileSync(targetModulePath, 'utf-8')
        maybeModuleXmlData = new DOMParser().parseFromString(targetModuleText)
        if (maybeModuleXmlData === undefined) {
          preparedDiagnostic.message = `Could not parse target document!: ${linkTargetModule}`
          diagnostics.push(preparedDiagnostic)
          continue
        }
        parsedOtherPages.set(linkTargetModule, maybeModuleXmlData)
      }
      const targetElements = select(
        `//cnxml:*[@id="${linkTargetId}"]`,
        maybeModuleXmlData
      ) as Node[]
      if (targetElements.length === 0) {
        preparedDiagnostic.message = `Target ID in document doesn't exist!: ${linkTargetId}`
        diagnostics.push(preparedDiagnostic)
        continue
      } else if (targetElements.length > 1) {
        preparedDiagnostic.message = `Target ID in document is not unique!: ${linkTargetId}`
        diagnostics.push(preparedDiagnostic)
        continue
      }
    }
  }

  return diagnostics
}

async function validateSamePageLinks(xmlData: Document): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const select = xpath.useNamespaces({ cnxml: NS_CNXML })
  const samePageLinks = select('//cnxml:link[@target-id and not(@document)]', xmlData) as Node[]
  const samePageElementsWithIds = select('//cnxml:*[@id]', xmlData) as Node[]
  const samePageIdCounts = new Map<string, number>()
  const validTargetIds = new Set<string>()
  const duplicateTargetIds = new Set<string>()

  for (const elementWithId of samePageElementsWithIds) {
    const element = elementWithId as any
    const elementId = element.getAttribute('id')

    if (elementId === '') {
      continue
    }

    const count = samePageIdCounts.get(elementId)
    if (count === undefined) {
      samePageIdCounts.set(elementId, 1)
    } else {
      samePageIdCounts.set(elementId, count + 1)
    }
  }

  samePageIdCounts.forEach((val, key, map) => {
    if (val === 1) {
      validTargetIds.add(key)
    }

    if (val > 1) {
      duplicateTargetIds.add(key)
    }
  })

  for (const link of samePageLinks) {
    // Check the document for a matching id element
    const linkElement = link as any
    const [startPosition, endPosition] = calculateElementPositions(linkElement)
    const preparedDiagnostic: Diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
      '',
      LINK_DIAGNOSTIC_SOURCE
    )
    const linkTargetId: string = linkElement.getAttribute('target-id')
    if ((linkTargetId === '') || (validTargetIds.has(linkTargetId))) {
      continue
    }

    if (duplicateTargetIds.has(linkTargetId)) {
      preparedDiagnostic.message = `Target for link is not unique!: ${linkTargetId}`
      diagnostics.push(preparedDiagnostic)
      continue
    } else {
      preparedDiagnostic.message = `Target for link doesn't exist!: ${linkTargetId}`
      diagnostics.push(preparedDiagnostic)
      continue
    }
  }

  return diagnostics
}

export function generateDiagnostic(severity: DiagnosticSeverity,
  startPosition: Position, endPosition: Position, message: string,
  diagnosticSource: string): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: severity,
    range: {
      start: startPosition,
      end: endPosition
    },
    message: message,
    source: diagnosticSource
  }
  return diagnostic
}

export function calculateElementPositions(element: any): Position[] {
  // Calculate positions accounting for the zero-based convention used by
  // vscode
  const startPosition: Position = {
    line: element.lineNumber - 1,
    character: element.columnNumber - 1
  }
  const elementSibling = element.nextSibling
  let endPosition: Position

  // Establish the end position using as much information as possible
  // based upon (in order of preference) 1) element sibling 2) final element
  // attribute 3) the tag
  if (elementSibling != null) {
    endPosition = {
      line: element.nextSibling.lineNumber - 1,
      character: element.nextSibling.columnNumber - 1
    }
  } else if (element.attributes.length > 0) {
    const elementAttributes = element.attributes
    const finalAttribute = elementAttributes[elementAttributes.length - 1]
    const finalAttributeColumn: number = finalAttribute.columnNumber
    const finalAttributeLength: number = finalAttribute.value.length

    endPosition = {
      line: finalAttribute.lineNumber - 1,
      character: finalAttributeColumn + finalAttributeLength + 1
    }
  } else {
    const elementTag = element.tagName
    const tagLength: number = elementTag.length
    const elementStartColumn: number = element.columnNumber

    endPosition = {
      line: element.lineNumber - 1,
      character: elementStartColumn + tagLength
    }
  }

  return [startPosition, endPosition]
}

export interface ValidationRequest {
  textDocument: TextDocument
  version: number
}

export class ValidationQueue {
  private queue: ValidationRequest[]
  private timer: NodeJS.Immediate | undefined

  constructor(private readonly connection: Connection) {
    this.queue = []
  }

  public addRequest(request: ValidationRequest): void {
    this.dropOldVersions(request)
    this.queue.push(request)
    this.trigger()
  }

  private dropOldVersions(request: ValidationRequest): void {
    // It's possible to get validation requests for the same document before
    // we've processed older ones. We can use the document version (which
    // increases after each change, even if it's undo / redo) to prune the queue
    const updatedQueue = this.queue.filter(entry => {
      const isOlderVersion = (entry.textDocument.uri === request.textDocument.uri) && (entry.version < request.version)
      const isDifferentDocument = (entry.textDocument.uri !== request.textDocument.uri)
      return (!isOlderVersion || isDifferentDocument)
    })

    this.queue = updatedQueue
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

  private async processQueue(): Promise<void> {
    const request = this.queue.shift()
    if (request === undefined) {
      return
    }
    const textDocument = request.textDocument
    let workspaceFolders = await this.connection.workspace.getWorkspaceFolders()
    if (workspaceFolders == null) {
      workspaceFolders = []
    }
    const diagnostics: Diagnostic[] = []
    const xmlData = parseXMLString(textDocument)
    const knownModules = await getCurrentModules(workspaceFolders)

    if (xmlData != null) {
      const imageValidation: Promise<Diagnostic[]> = validateImagePaths(textDocument, xmlData)
      const linkValidation: Promise<Diagnostic[]> = validateLinks(xmlData, knownModules)
      await Promise.all([imageValidation, linkValidation]).then(results => {
        results.forEach(diags => diagnostics.push(...diags))
      })
    }

    this.connection.sendDiagnostics({
      uri: textDocument.uri,
      diagnostics
    })
  }
}

/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
export function expect<T>(value: T | null | undefined, message?: string): T {
  if (value == null) {
    throw new Error(message ?? 'Unwrapped a null value')
  }
  return value
}
