import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Connection
} from 'vscode-languageserver/node'
import fs from 'fs'

export const IMAGEPATH_DIAGNOSTIC_SOURCE = 'Image validation'
export const LINK_DIAGNOSTIC_SOURCE = 'Link validation'


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

// export interface ValidationRequest {
//   textDocument: TextDocument
//   version: number
// }

// export class ValidationQueue {
//   private queue: ValidationRequest[]
//   private timer: NodeJS.Immediate | undefined

//   constructor(private readonly connection: Connection) {
//     this.queue = []
//   }

//   public addRequest(request: ValidationRequest): void {
//     this.dropOldVersions(request)
//     this.queue.push(request)
//     this.trigger()
//   }

//   private dropOldVersions(request: ValidationRequest): void {
//     // It's possible to get validation requests for the same document before
//     // we've processed older ones. We can use the document version (which
//     // increases after each change, even if it's undo / redo) to prune the queue
//     const updatedQueue = this.queue.filter(entry => {
//       const isOlderVersion = (entry.textDocument.uri === request.textDocument.uri) && (entry.version < request.version)
//       const isDifferentDocument = (entry.textDocument.uri !== request.textDocument.uri)
//       return (!isOlderVersion || isDifferentDocument)
//     })

//     this.queue = updatedQueue
//   }

//   private trigger(): void {
//     if (this.timer !== undefined || this.queue.length === 0) {
//       // Either the queue is empty, or we're already set to process the next
//       // entry
//       return
//     }

//     this.timer = setImmediate(() => {
//       this.processQueue().finally(() => {
//         this.timer = undefined
//         this.trigger()
//       })
//     })
//   }

//   private async processQueue(): Promise<void> {
//     const request = this.queue.shift()
//     if (request === undefined) {
//       return
//     }
//     const textDocument = request.textDocument
//     let workspaceFolders = await this.connection.workspace.getWorkspaceFolders()
//     if (workspaceFolders == null) {
//       workspaceFolders = []
//     }
//     const diagnostics: Diagnostic[] = []
//     const xmlData = parseXMLString(textDocument)
//     const knownModules = await getCurrentModules(workspaceFolders)

//     if (xmlData != null) {
//       const imageValidation: Promise<Diagnostic[]> = validateImagePaths(textDocument, xmlData)
//       const linkValidation: Promise<Diagnostic[]> = validateLinks(xmlData, knownModules)
//       await Promise.all([imageValidation, linkValidation]).then(results => {
//         results.forEach(diags => diagnostics.push(...diags))
//       })
//     }

//     this.connection.sendDiagnostics({
//       uri: textDocument.uri,
//       diagnostics
//     })
//   }
// }

/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

export const fileExists = async (filepath: string) => {
  let exists = true
  await fs.promises.access(filepath).catch(err => { exists = false })
  return exists
}
