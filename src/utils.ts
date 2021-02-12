
import vscode from 'vscode'
import path from 'path'

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
export function expect<T>(value: T | null | undefined, message?: string): T {
  if (value == null) {
    throw new Error(message ?? 'Unwrapped a null value')
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
export function ensureCatch(func: (...args: any[]) => Promise<any>): (...args: any[]) => void {
  return (...args: any[]) => {
    func(...args).catch((err: Error) => {
      throw err
    })
  }
}
