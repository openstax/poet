import vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { each } from 'async';
import { promises as fsPromises } from 'fs';
import xmlFormat from 'xml-formatter';
import { DOMParser, XMLSerializer } from 'xmldom';
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect } from './utils';

const NS_COLLECTION = 'http://cnx.rice.edu/collxml';
const NS_CNXML = 'http://cnx.rice.edu/cnxml';
const NS_METADATA = 'http://cnx.rice.edu/mdml';

const guessedModuleTitles: {[key: string]: string} = {};

type TocTreeModule = {
  type: 'module',
  moduleid: string,
  title: string,
  subtitle?: string
}

type TocTreeCollection = {
  type: 'collection' | 'subcollection',
  title: string,
  slug?: string,
  children: Array<TocTreeElement>
}

type TocTreeElement = TocTreeModule | TocTreeCollection

/**
 * Guess all module titles by reading the modules asynchronously and
 * just looking for the title tag with a specific namespace prefix.
 * This can yield incomplete results, but is about 50x faster than
 * preloading the module titles via parsing individual modules as XML
 */
async function preloadGuessedModuleTitles() {
	const uri = getRootPathUri();
	if (uri == null) {
		return;
	}
	const moduleDirs = await fsPromises.readdir(path.join(uri.fsPath, 'modules'));
	await each(moduleDirs, async (moduleDir) => {
		const module = uri.with({ path: path.join(uri.path, 'modules', moduleDir, 'index.cnxml') });
		const xml = await fsPromises.readFile(module.fsPath, { encoding: 'utf-8' });
		const titleTagStart = xml.indexOf('<md:title>');
		const titleTagEnd = xml.indexOf('</md:title>');
		if (titleTagStart === -1 || titleTagEnd === -1) {
			return;
		}
		const actualTitleStart = titleTagStart + 10; // Add length of '<md:title>'
		if (titleTagEnd - actualTitleStart > 280) {
			// If the title is so long you can't tweet it,
			// then something probably went wrong.
			return;
		}
		const moduleTitle = xml.substring(actualTitleStart, titleTagEnd).trim();
		guessedModuleTitles[moduleDir] = moduleTitle;
	});
}

export function showTocEditor(resourceRootDir: string) {
  return async () => {
    await preloadGuessedModuleTitles();
    const panel = vscode.window.createWebviewPanel(
      "openstax.tocEditor",
      "Table of Contents Editor",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      },
    );
  
    let html = fs.readFileSync(path.join(resourceRootDir, 'toc-editor.html'), 'utf-8');
    html = fixResourceReferences(panel.webview, html, resourceRootDir);
    html = fixCspSourceReferences(panel.webview, html);
    panel.webview.html = html;
  
    panel.reveal(vscode.ViewColumn.One);
  
    let messageQueued: {uneditable: Array<TocTreeCollection>, editable: Array<TocTreeCollection>} = {
      uneditable: [],
      editable: []
    }
    const uri = getRootPathUri();
    if (uri != null) {
      const collectionFiles = fs.readdirSync(path.join(uri.fsPath, 'collections'));
      const collectionTrees = [];
      for (const collectionFile of collectionFiles) {
        const collectionData = fs.readFileSync(path.join(uri.fsPath, 'collections', collectionFile), { encoding: 'utf-8' });
        collectionTrees.push(parseCollection(collectionData));
      }
      // Some special non-editable collections
      const allModules = fs.readdirSync(path.join(uri.fsPath, 'modules'));
      const usedModules: Array<string> = [];
      for (const collectionTree of collectionTrees) {
        insertUsedModules(usedModules, collectionTree);
      }
      const usedModulesSet = new Set(usedModules);
      const orphanModules = allModules.filter(x => !usedModulesSet.has(x));
      const collectionAllModules: TocTreeCollection = {
        type: 'collection',
        title: 'All Modules',
        slug: 'mock-slug__source-only',
        children: allModules.map(moduleObjectFromModuleId).sort((m, n) => m.moduleid.localeCompare(n.moduleid))
      };
      const collectionOrphanModules: TocTreeCollection = {
        type: 'collection',
        title: 'Orphan Modules',
        slug: 'mock-slug__source-only',
        children: orphanModules.map(moduleObjectFromModuleId).sort((m, n) => m.moduleid.localeCompare(n.moduleid))
      };

      messageQueued = {
        uneditable: [collectionAllModules, collectionOrphanModules],
        editable: collectionTrees
      }
    }
  
    panel.webview.onDidReceiveMessage(async (message) => {
      const { signal } = message;
      if (signal != null) {
        if (signal === 'loaded') {
          panel.webview.postMessage(messageQueued)
        }
      }
      const { treeData } = message;
      const uri = getRootPathUri();
      if (uri != null && treeData != null) {
        const replacingUri = uri.with({ path: path.join(uri.fsPath, 'collections', `${treeData.slug}.collection.xml`)});
        const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' });
        const document = new DOMParser().parseFromString(collectionData);
        replaceCollectionContent(document, treeData);
        const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(document), {
          indentation: '  ',
          collapseContent: true,
          lineSeparator: '\n'
        });
        console.log(`writing: ${replacingUri.toString()}`);
        const textDocument = await vscode.workspace.openTextDocument(replacingUri);
        const fullRange = new vscode.Range(
          textDocument.positionAt(0),
          textDocument.positionAt(textDocument.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(replacingUri, fullRange, serailizedXml);
        vscode.workspace.applyEdit(edit);
      }
    });
  };
}

function insertUsedModules(arr: Array<string>, tree: TocTreeElement){
	if (tree.type === 'module') {
		arr.push(tree.moduleid);
	} else if (tree.children) {
		for (const child of tree.children) {
			insertUsedModules(arr, child);
		}
	}
}

function moduleObjectFromModuleId(moduleid: string): TocTreeModule {
	return {
    type: 'module',
    moduleid: moduleid,
    title: getModuleTitle(moduleid)
  };
}

function moduleToObject(element: any): TocTreeModule {
	const moduleid = element.getAttribute('document');
  return moduleObjectFromModuleId(expect(moduleid, 'Module ID missing'));
}

function subcollectionToObject(element: any): TocTreeCollection {
  const title = element.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent;
	const content = element.getElementsByTagNameNS(NS_COLLECTION, 'content')[0];
  return {
    type: 'subcollection',
    title: expect(title, 'Subcollection title missing'),
    children: childObjects(content)
  };
}

function childObjects(element: any): Array<TocTreeElement> {
	const children = [];
  for (const child of Array.from<any>(element.childNodes)) {
    if (child.localName === 'module') {
      children.push(moduleToObject(child));
    } else if (child.localName === 'subcollection') {
      children.push(subcollectionToObject(child));
    }
  }
  return children;
}

function parseCollection(xml: string): TocTreeCollection {
	const document = new DOMParser().parseFromString(xml);

  const metadata = document.getElementsByTagNameNS(NS_COLLECTION, 'metadata')[0];
  const collectionTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent;
  const collectionSlug = metadata.getElementsByTagNameNS(NS_METADATA, 'slug')[0].textContent;
  
  const treeRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0];

  return {
    type: 'collection',
		title: expect(collectionTitle, 'Collection title missing'),
		slug: expect(collectionSlug, 'Collection slug missing'),
    children: childObjects(treeRoot)
  };
}

function populateTreeDataToXML(document: XMLDocument, root: any, treeData: TocTreeCollection) {
	for (const child of treeData.children) {
		const element = document.createElementNS(NS_COLLECTION, child.type);
		 // md prefix is technically a guess. If incorrect, document may have a lot of xmlns:md attributes
		const title = document.createElementNS(NS_METADATA, 'md:title');
		const titleContent = document.createTextNode(child.title);
		title.appendChild(titleContent);
		element.appendChild(title);
		root.appendChild(element);
		if (child.type === 'subcollection') {
			const contentWrapper = document.createElementNS(NS_COLLECTION, 'content');
			element.appendChild(contentWrapper);
			populateTreeDataToXML(document, contentWrapper, child);
		} else if (child.type === 'module') {
			element.setAttribute('document', child.moduleid);
		}
	}
}

function replaceCollectionContent(document: XMLDocument, treeData: TocTreeCollection) {
	const content = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0];

	const newContent = document.createElementNS(NS_COLLECTION, 'content');
	content.parentNode!.replaceChild(newContent, content);
	populateTreeDataToXML(document, newContent, treeData);
}


function getModuleTitle(moduleid: string): string {
	if (guessedModuleTitles.hasOwnProperty(moduleid)) {
		return guessedModuleTitles[moduleid];
	}
	const uri = getRootPathUri();
	if (uri == null) {
		return '';
	}
	const module = uri.with({ path: path.join(uri.path, 'modules', moduleid, 'index.cnxml') });
	const xml = fs.readFileSync(module.fsPath, { encoding: 'utf-8' });
	const document = new DOMParser().parseFromString(xml);
	try {
		const metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0];
		const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent;
		return moduleTitle || 'Unnamed Module';
	} catch {
		return 'Unnamed Module';
	}
}