
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

// So that relative <img src="./..."> work
export function addBaseHref(webview: vscode.Webview, resource: vscode.Uri, html: string): string {
  const re = /\${BASE_URI}/g
  const baseUri = webview.asWebviewUri(resource).toString()
  return html.replace(re, baseUri)
}

export function getLocalResourceRoots(roots: vscode.Uri[], resource: vscode.Uri): readonly vscode.Uri[] {
  const baseRoots = roots

  const folder = vscode.workspace.getWorkspaceFolder(resource)
  if (folder != null) {
    const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri)
    if (workspaceRoots != null) {
      baseRoots.push(...workspaceRoots)
    }
  } else if (resource.scheme === '' || resource.scheme === 'file') {
    baseRoots.push(vscode.Uri.file(path.dirname(resource.fsPath)))
  }

  return baseRoots
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

/*
 * Provides very simple reject handling for async functions (just throws)
 * to avoid silent failures when passing a fallible async callback function
 * to something that expects a sync callback function.
 * This comes at the cost of not preserving the original return type as well
 * as the resulting thrown error being uncatchable.
 */
export function ensureCatch(func: (...args: any[]) => Promise<any>): (...args: any[]) => Promise<any> {
  return (...args: any[]) => {
    return func(...args).catch((err: Error) => {
      void vscode.window.showErrorMessage(err.message)
      throw err
    })
  }
}

export function populateXsdSchemaFiles(resourceRootDir: string): void {
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
  fs.rmdirSync(targetPath, { recursive: true })
  fs.mkdirSync(targetPath)

  // Copy all schema files
  const schemaFiles = fs.readdirSync(sourcePath)
  schemaFiles.forEach(val => {
    fs.copyFileSync(
      path.join(sourcePath, val),
      path.join(targetPath, val)
    )
  })
}

export function launchLanguageServer(context: vscode.ExtensionContext): LanguageClient {
  const serverModule = context.asAbsolutePath(
    path.join('server', 'dist', 'server.js')
  )
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] }

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
        vscode.workspace.createFileSystemWatcher('**/media/**'),
        vscode.workspace.createFileSystemWatcher('**/modules/**'),
        vscode.workspace.createFileSystemWatcher('**/collections/**')
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

  // Start the client. This will also launch the server
  client.start()

  return client
}
