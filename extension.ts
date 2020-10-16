
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	
	vscode.commands.registerCommand('openstax.showPreviewToSide', (uri?: vscode.Uri, previewSettings?: any) => {
		let resource = uri;
		let contents: string | null = null;
		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri === uri) {
			contents = vscode.window.activeTextEditor.document.getText()
		}
		// support previewing XML that has not been saved yet
		if (!(resource instanceof vscode.Uri)) {
			if (vscode.window.activeTextEditor) {
				resource = vscode.window.activeTextEditor.document.uri;
				contents = vscode.window.activeTextEditor.document.getText()
			}
		}
		if (!resource) { return }

		if (!contents) {
			contents = fs.readFileSync(resource.fsPath, 'utf-8')
		}

		const resourceColumn = (vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn) || vscode.ViewColumn.One;
		const previewColumn = resourceColumn + 1 // because the preview is on the side

		let resourceRootDir = path.join(__dirname, '../') // because the extension is running in the ./out/ subdir

		const panel = vscode.window.createWebviewPanel(
			'openstax.previewThing',
			`Preview ${path.basename(resource.fsPath)}`,
			previewColumn, { 
				enableScripts: true,
				localResourceRoots: getLocalResourceRoots([vscode.Uri.file(resourceRootDir),], resource),
				enableFindWidget: true, });

		let html = fs.readFileSync(path.join(resourceRootDir, 'preview.html'), 'utf-8')
		html = addBaseHref(panel.webview, resource, html)
		html = fixResourceReferences(panel.webview, html, resourceRootDir);
		html = fixCspSourceReferences(panel.webview, html)
		panel.webview.html = html;

		const xml = contents
		panel.webview.postMessage({xml})
		let throttleTimer = setTimeout(updatePreview, 200)

		async function updatePreview() {
			clearTimeout(throttleTimer);
			let document: vscode.TextDocument;
			if (!resource) return // it will never be empty at this point
			try {
				document = await vscode.workspace.openTextDocument(resource);
			} catch {
				return;
			}
			const newContents = document.getText()
			if (contents !== newContents) {
				contents = newContents
				panel.webview.postMessage({xml: contents})
			}
			throttleTimer = setTimeout(updatePreview, 200)
		}

		// https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing
		panel.webview.onDidReceiveMessage(async (message) => {
			// Replace the full-source version with what came out of the preview panel
			if (!resource) { return } // it will never be empty at this point
			try {
				const document = await vscode.workspace.openTextDocument(resource);
				const fullRange = new vscode.Range(
					document.positionAt(0),
					document.positionAt(document.getText().length)
				)
				const edit = new vscode.WorkspaceEdit()
				edit.replace(resource, fullRange, message.xml)
				vscode.workspace.applyEdit(edit)
			} catch { }
		});
		
	})
}

export async function deactivate(): Promise<void> {
}





/**
 * Replace references to href="./file" or src="./file" with VS Code resource URIs.
 */
function fixResourceReferences(webview: vscode.Webview, html: string, resourceRootDir: string): string {
	const refRegex = /((href)|(src))="(\.\/[^"]+)"/g;
	let refMatch;
	while ((refMatch = refRegex.exec(html)) !== null) {
		const offset = refMatch.index;
		const length = refMatch[0].length;
		const refAttr = refMatch[1];
		const refName = refMatch[4];
		const refPath = path.join(resourceRootDir, refName);
		const refUri = webview.asWebviewUri(vscode.Uri.file(refPath));
		const refReplace = refAttr + "=\"" + refUri + "\"";
		html = html.slice(0, offset) + refReplace + html.slice(offset + length);
	}
	return html;
}

/**
 * Replace references to ${WEBVIEW_CSPSOURCE} with the actual value.
 */
function fixCspSourceReferences(webview: vscode.Webview, html: string): string {
	const re = /\${WEBVIEW_CSPSOURCE}/g;
	return html.replace(re, webview.cspSource)
}

// So that relative <img src="./..."> work
function addBaseHref(webview: vscode.Webview, resource: vscode.Uri, html: string): string {
	const re = /\${BASE_URI}/g;
	const baseUri = webview.asWebviewUri(resource).toString();
	return html.replace(re, baseUri)
}

function getLocalResourceRoots(roots: vscode.Uri[], resource: vscode.Uri): ReadonlyArray<vscode.Uri> {
	const baseRoots = roots;

	const folder = vscode.workspace.getWorkspaceFolder(resource);
	if (folder) {
		const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri);
		if (workspaceRoots) {
			baseRoots.push(...workspaceRoots);
		}
	} else if (!resource.scheme || resource.scheme === 'file') {
		baseRoots.push(vscode.Uri.file(path.dirname(resource.fsPath)));
	}

	return baseRoots
}
