
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

const resourceRootDir = path.join(__dirname, '../src/') // because the extension is running in the ./out/ subdir
let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	launchLanguageServer(context);
	showDashboard(context)
	showImageUpload(context)

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
	if (!client) {
		return undefined;
	}
	return client.stop();
}

function launchLanguageServer(context: vscode.ExtensionContext) {
	let serverModule = context.asAbsolutePath(
		path.join('server', 'dist', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'xml' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerCnxml',
		'CNXML Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

function showImageUpload(context: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		"openstax.imageUpload",
		"ImageUpload",
		vscode.ViewColumn.Two,
		{
			enableScripts: true,
		},
	);

	let html = fs.readFileSync(path.join(resourceRootDir, 'image-upload.html'), 'utf-8');
	html = fixResourceReferences(panel.webview, html, resourceRootDir);
	html = fixCspSourceReferences(panel.webview, html)
	panel.webview.html = html;

	panel.reveal(vscode.ViewColumn.Two)

	panel.webview.onDidReceiveMessage(async (message) => {
		const { mediaUploads } = message;
		if (mediaUploads != null) {
			const maybeRootPath = vscode.workspace.workspaceFolders;
			const rootPath = maybeRootPath ? maybeRootPath[0] : null;
			if (rootPath != null) {
				for (const upload of mediaUploads) {
					const { mediaName, data } = upload;
					// vscode.Uri.joinPath is not in the latest theia yet
					// const newFileUri = vscode.Uri.joinPath(rootPath.uri, 'media', mediaName);
					const uri = rootPath.uri
					const newFileUri = uri.with({ path: path.join(uri.path, 'media', mediaName) })
					try {
						await vscode.workspace.fs.stat(newFileUri)
						// File exists already, do nothing for now
					} catch (err) {
						if (err instanceof vscode.FileSystemError && err.name.includes('EntryNotFound')) {
							console.log(`writing: ${newFileUri.toString()}`)
							const content = Buffer.from(data.split(',')[1], 'base64');
							vscode.workspace.fs.writeFile(newFileUri, content);
						}
					}
				}
			}
		}
	});

	panel.onDidDispose(() => {
		showImageUpload(context)
	}, null, context.subscriptions);
}

function showDashboard(context: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		"openstax.dashboardThing",
		"Book Dashboard",
		vscode.ViewColumn.One,
		{
			enableScripts: true,
		},
	);

	let html = fs.readFileSync(path.join(resourceRootDir, 'dashboard.html'), 'utf-8')
	html = fixResourceReferences(panel.webview, html, resourceRootDir);
	html = fixCspSourceReferences(panel.webview, html)
	panel.webview.html = html;

	panel.reveal(vscode.ViewColumn.One)

	// Reopen when the dashboard is closed (HACK to keep the panel open)
	panel.onDidDispose(() => {
		showDashboard(context)
	}, null, context.subscriptions);

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
