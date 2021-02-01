
import vscode from 'vscode';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { each } from 'async';
import xmlFormat from 'xml-formatter'

const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
const NS_METADATA = 'http://cnx.rice.edu/mdml'

const guessedModuleTitles: {[key: string]: string} = {}

const resourceRootDir = path.join(__dirname, '../src/') // because the extension is running in the ./out/ subdir

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await preloadGuessedModuleTitles()
	showDashboard(context)
	showImageUpload(context)

	vscode.commands.registerCommand('openstax.showPreviewToSide', showPreviewPanel)
}

export async function deactivate(): Promise<void> {
}

/**
 * Guess all module titles by reading the modules asynchronously and
 * just looking for the title tag with a specific namespace prefix.
 * This can yield incomplete results, but is about 50x faster than
 * preloading the module titles via parsing XML with JSDOM
 */
async function preloadGuessedModuleTitles() {
	const rootPath = getRootPath()
	if (rootPath != null) {
		const uri = rootPath.uri
		const moduleDirs = await fsPromises.readdir(path.join(uri.fsPath, 'modules'))
		await each(moduleDirs, async (moduleDir) => {
			const module = uri.with({ path: path.join(uri.path, 'modules', moduleDir, 'index.cnxml') })
			const xml = await fsPromises.readFile(module.fsPath, { encoding: 'utf-8' })
			const titleTagStart = xml.indexOf('<md:title>')
			const titleTagEnd = xml.indexOf('</md:title>')
			if (titleTagStart === -1 || titleTagEnd === -1) {
				return
			}
			const actualTitleStart = titleTagStart + 10 // Add length of '<md:title>'
			if (titleTagEnd - actualTitleStart > 280) {
				// If the title is so long you can't tweet it,
				// then something probably went wrong.
				return
			}
			const moduleTitle = xml.substring(actualTitleStart, titleTagEnd).trim()
			guessedModuleTitles[moduleDir] = moduleTitle
		})
	}
}

function showPreviewPanel(uri?: vscode.Uri, previewSettings?: any) {
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
		const rootPath = getRootPath();
		if (mediaUploads != null && rootPath != null) {
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

	let html = fs.readFileSync(path.join(resourceRootDir, 'toc-editor.html'), 'utf-8')
	html = fixResourceReferences(panel.webview, html, resourceRootDir);
	html = fixCspSourceReferences(panel.webview, html)
	panel.webview.html = html;

	panel.reveal(vscode.ViewColumn.One)

	const rootPath = getRootPath()
	if (rootPath != null) {
		const uri = rootPath.uri
		const collectionFiles = fs.readdirSync(path.join(uri.fsPath, 'collections'))
		const collectionTrees = []
		for (const collectionFile of collectionFiles) {
			const collectionData = fs.readFileSync(path.join(uri.fsPath, 'collections', collectionFile), { encoding: 'utf-8' })
			collectionTrees.push(parseCollection(collectionData))
		}
		// Some special non-editable collections
		const allModules = fs.readdirSync(path.join(uri.fsPath, 'modules'))
		const usedModules: Array<string> = []
		for (const collectionTree of collectionTrees) {
			insertUsedModules(usedModules, collectionTree)
		}
		const usedModulesSet = new Set(usedModules)
		const orphanModules = allModules.filter(x => !usedModulesSet.has(x))
		const collectionAllModules = {
			type: 'collection',
			title: 'All Modules',
			slug: 'mock-slug__source-only',
			children: allModules.map(moduleObjectFromModuleId).sort((m, n) => moduleIdNumber(m.moduleid) - moduleIdNumber(n.moduleid))
		}
		const collectionOrphanModules = {
			type: 'collection',
			title: 'Orphan Modules',
			slug: 'mock-slug__source-only',
			children: orphanModules.map(moduleObjectFromModuleId).sort((m, n) => moduleIdNumber(m.moduleid) - moduleIdNumber(n.moduleid))
		}

		panel.webview.postMessage({
			uneditable: [collectionAllModules, collectionOrphanModules],
			editable: collectionTrees
		})
	}

	panel.webview.onDidReceiveMessage(async (message) => {
		const { treeData } = message
		const rootPath = getRootPath()
		if (rootPath != null) {
			const uri = rootPath.uri
			const replacingUri = uri.with({ path: path.join(uri.fsPath, 'collections', `${treeData.slug}.collection.xml`)})
			const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' })
			const dom = new JSDOM(collectionData, { contentType: 'text/xml' });
			replaceCollectionContent(dom.window.document, treeData)
			const serailizedXml = xmlFormat(dom.serialize(), {
				indentation: '  ',
				collapseContent: true,
				lineSeparator: '\n'
			})
			console.log(`writing: ${replacingUri.toString()}`)
			const document = await vscode.workspace.openTextDocument(replacingUri);
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length)
			)
			const edit = new vscode.WorkspaceEdit()
			edit.replace(replacingUri, fullRange, serailizedXml)
			vscode.workspace.applyEdit(edit)
		}
	});

	// Reopen when the dashboard is closed (HACK to keep the panel open)
	panel.onDidDispose(() => {
		showDashboard(context)
	}, null, context.subscriptions);
}

function moduleIdNumber(moduleid: string): number {
	const numberPart = moduleid.substr(1)
	return parseInt(numberPart)
}

function insertUsedModules(arr: Array<string>, tree: any){
	if (tree.type === 'module') {
		arr.push(tree.moduleid)
	} else if (tree.children) {
		for (const child of tree.children) {
			insertUsedModules(arr, child)
		}
	}
}

function moduleObjectFromModuleId(moduleid: string): any {
	return {
    type: 'module',
		moduleid: moduleid,
		title: getModuleTitle(moduleid)
  }
}

function moduleToObject(element: Element): any {
	const moduleid = element.getAttribute('document')
	if (moduleid == null) {
		throw new Error('Error parsing collection. ModuleID missing.')
	}
  return moduleObjectFromModuleId(moduleid)
}

function subcollectionToObject(element: Element): any {
  const title = element.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
	const content = element.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
	if (title == null) {
		throw new Error('Error parsing collection. Subcollection title missing.')
	}
  return {
    type: 'subcollection',
    title: title,
    children: childObjects(content)
  }
}

function childObjects(element: Element): Array<any> {
  const children = []
  for (const child of element.children) {
    if (child.localName === 'module') {
      children.push(moduleToObject(child))
    } else if (child.localName === 'subcollection') {
      children.push(subcollectionToObject(child))
    }
  }
  return children
}

function parseCollection(xml: string): any {
	const dom = new JSDOM(xml, { contentType: 'text/xml' });
  const document = dom.window.document

  const metadata = document.getElementsByTagNameNS(NS_COLLECTION, 'metadata')[0]
  const collectionTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
  const collectionSlug = metadata.getElementsByTagNameNS(NS_METADATA, 'slug')[0].textContent
  
  const treeRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

  const tree = {
    type: 'collection',
		title: collectionTitle,
		slug: collectionSlug,
    children: childObjects(treeRoot)
  }

  return tree
}

function populateTreeDataToXML(document: XMLDocument, root: Element, treeData: any) {
	for (const child of treeData.children) {
		const element = document.createElementNS(NS_COLLECTION, child.type)
		const title = document.createElementNS(NS_METADATA, 'title')
		const titleContent = document.createTextNode(child.title)
		title.appendChild(titleContent)
		element.appendChild(title)
		root.appendChild(element)
		if (child.type === 'subcollection') {
			const contentWrapper = document.createElementNS(NS_COLLECTION, 'content')
			element.appendChild(contentWrapper)
			populateTreeDataToXML(document, contentWrapper, child)
		} else if (child.type === 'module') {
			element.setAttribute('document', child.moduleid)
		}
	}
}

function replaceCollectionContent(document: XMLDocument, treeData: any) {
	const content = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

	const newContent = document.createElementNS(NS_COLLECTION, 'content')
	populateTreeDataToXML(document, newContent, treeData)

	content.parentElement!.replaceChild(newContent, content)
}


function getModuleTitle(moduleid: string): string {
	if (guessedModuleTitles.hasOwnProperty(moduleid)) {
		return guessedModuleTitles[moduleid]
	}
	const rootPath = getRootPath()
	if (rootPath == null) {
		return ''
	}
	const uri = rootPath.uri
	const module = uri.with({ path: path.join(uri.path, 'modules', moduleid, 'index.cnxml') })
	const xml = fs.readFileSync(module.fsPath, { encoding: 'utf-8' })
	const dom = new JSDOM(xml, { contentType: 'text/xml' });
	const document = dom.window.document
	try {
		const metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
		const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
		return moduleTitle || 'Unnamed Module'
	} catch {
		return 'Unnamed Module'
	}
	 
}

/**
 * Return the root path of the workspace, or null if it does not exist
 */
function getRootPath(): vscode.WorkspaceFolder | null {
	const maybeRootPath = vscode.workspace.workspaceFolders;
	const rootPath = maybeRootPath ? maybeRootPath[0] : null;
	return rootPath
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
