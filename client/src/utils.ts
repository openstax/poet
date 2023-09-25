
import vscode from 'vscode'
import path from 'path'
import fs from 'fs'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node'

/**
 * Replace references to href="./file" or src="./file" with VS Code resource URIs.
 */
export function fixResourceReferences(webview: vscode.Webview, html: string, resourceRootDir: string): string {
  const refRegex = /((href)|(src))="(\.\/[^"]+)"/g
  let refMatch
  while ((refMatch = refRegex.exec(html)) != null) {
    const offset = refMatch.index
    const length = refMatch[0].length
    const refAttr = refMatch[1]
    const refName = refMatch[4]
    const refPath = path.join(resourceRootDir, refName)
    const refUri = webview.asWebviewUri(vscode.Uri.file(refPath))
    const refReplace = `${refAttr}="${refUri.toString()}"`
    html = html.slice(0, offset) + refReplace + html.slice(offset + length)
  }
  return html
}

/**
 * Replace references to ${WEBVIEW_CSPSOURCE} with the actual value.
 */
export function fixCspSourceReferences(webview: vscode.Webview, html: string): string {
  const re = /\${WEBVIEW_CSPSOURCE}/g
  return html.replace(re, webview.cspSource)
}

export function injectCspNonce(html: string, nonce: string): string {
  const re = /\${NONCE}/g
  return html.replace(re, nonce)
}

export function genNonce(): string {
  let nonce = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return nonce
}

// So that relative <img src="./..."> work
export function addBaseHref(webview: vscode.Webview, resource: vscode.Uri, html: string): string {
  const re = /\${BASE_URI}/g
  const baseUri = webview.asWebviewUri(resource).toString()
  return html.replace(re, baseUri)
}

/**
 * Return the root path of the workspace, or null if it does not exist
 */
export function getRootPathUri(): vscode.Uri | null {
  const maybeWorkspace = vscode.workspace.workspaceFolders
  const rootPath = maybeWorkspace != null ? maybeWorkspace[0] : null
  return rootPath != null ? rootPath.uri : null
}

/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    void vscode.window.showErrorMessage(message)
    throw new Error(message)
  }
  return value
}

/**
 * Provides very simple reject handling for async functions (just throws)
 * to avoid silent failures when passing a fallible async callback function
 * to something that expects a sync callback function.
 * This comes at the cost of not preserving the original return type as well
 * as the resulting thrown error being uncatchable.
 */
export function ensureCatch<T extends unknown[], U>(func: (...args: T) => Promise<U>): (...args: T) => Promise<U> {
  return async (...args: T) => {
    return await func(...args).catch((err: Error) => {
      void vscode.window.showErrorMessage(err.message)
      throw err
    })
  }
}

/**
 * Provides very simple reject handling for promises (just throws)
 * to avoid silent failures when calling a fallible async function from
 * a synchronous function.
 * This comes at the cost of not preserving the original return type
 * as well as the resulting thrown error being uncatchable.
 */
export async function ensureCatchPromise<T>(promise: Promise<T>): Promise<void> {
  await promise.catch(err => {
    void vscode.window.showErrorMessage(err.message)
    throw err
  })
}

export async function populateXsdSchemaFiles(resourceRootDir: string): Promise<void> {
  const relResourcePath = 'xsd'
  const relTargetPath = '.xsd'
  const uri = getRootPathUri()
  if (uri == null) {
    return
  }

  const targetPath = path.join(uri.fsPath, relTargetPath)
  const sourcePath = path.join(resourceRootDir, relResourcePath)

  // Delete any existing directory and create a new one to ensure no old
  // schema files are kept around
  if (fs.existsSync(targetPath)) {
    fs.rmdirSync(targetPath, { recursive: true })
  }
  fs.mkdirSync(targetPath)

  // Copy all schema files
  const schemaFiles = fs.readdirSync(sourcePath)
  schemaFiles.forEach(val => {
    fs.copyFileSync(
      path.join(sourcePath, val),
      path.join(targetPath, val)
    )
  })

  const xmlExtension = await expect(
    vscode.extensions.getExtension('redhat.vscode-xml'),
    'Expected redhat.vscode-xml extension to be installed'
  ).activate()
  xmlExtension.addXMLCatalogs([`./${relTargetPath}/catalog.xml`])
}

export function launchLanguageServer(context: vscode.ExtensionContext): LanguageClient {
  const serverModule = context.asAbsolutePath(
    path.join('server', 'dist', 'server.js')
  )
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ['--nolazy', '--inspect=16009'] }

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions
    }
  }

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for XML documents
    documentSelector: [{ scheme: 'file', language: 'xml' }],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/META-INF/books.xml'),
        vscode.workspace.createFileSystemWatcher('**/media/**'),
        vscode.workspace.createFileSystemWatcher('**/*.cnxml'),
        vscode.workspace.createFileSystemWatcher('**/*.collection.xml')
      ]
    }
  }

  // Create the language client and start the client.
  const client = new LanguageClient(
    'languageServerCnxml',
    'CNXML Language Server',
    serverOptions,
    clientOptions
  )

  return client
}

export function getErrorDiagnosticsBySource(): Map<string, Array<[vscode.Uri, vscode.Diagnostic]>> {
  const errorsBySource = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
  const diagnostics = vscode.languages.getDiagnostics()

  for (const [uri, fileDiagnostics] of diagnostics) {
    for (const diag of fileDiagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error)) {
      const source = diag.source
      if (source === undefined) {
        continue
      }

      const existingErrors = errorsBySource.get(source)
      if (existingErrors === undefined) {
        errorsBySource.set(source, [[uri, diag]])
      } else {
        existingErrors.push([uri, diag])
      }
    }
  }

  return errorsBySource
}

/**
 * This is, hopefully, a temporary solution to the settings.json file failing to load in GitPod.
 * It sets the value of one property to '', then resets it to it's original value, effectively
 * forcing the settings to reload.
 */
export async function configureWorkspaceSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration()
  const property = 'files.associations'
  const target = vscode.ConfigurationTarget.Workspace
  let value = config.get(property, {})
  if (Object.keys(value).length === 0) {
    value = { '*.cnxml': 'xml' }
  }
  await config.update(property, '', target)
  await config.update(property, value, target)
}
