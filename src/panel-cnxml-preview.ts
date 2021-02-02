import vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { fixResourceReferences, fixCspSourceReferences, addBaseHref, getLocalResourceRoots } from './utils';

export function showCnxmlPreview(resourceRootDir: string) {
  return async (uri?: vscode.Uri, previewSettings?: any) => {
    let resource = uri;
    let contents: string | null = null;
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri === uri) {
      contents = vscode.window.activeTextEditor.document.getText();
    }
    // support previewing XML that has not been saved yet
    if (!(resource instanceof vscode.Uri)) {
      if (vscode.window.activeTextEditor) {
        resource = vscode.window.activeTextEditor.document.uri;
        contents = vscode.window.activeTextEditor.document.getText();
      }
    }
    if (!resource) { return; }

    if (!contents) {
      contents = fs.readFileSync(resource.fsPath, 'utf-8');
    }

    const resourceColumn = (vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn) || vscode.ViewColumn.One;
    const previewColumn = resourceColumn + 1; // because the preview is on the side

    const panel = vscode.window.createWebviewPanel(
      'openstax.cnxmlPreview',
      `Preview ${path.basename(resource.fsPath)}`,
      previewColumn, {
        enableScripts: true,
        localResourceRoots: getLocalResourceRoots([vscode.Uri.file(resourceRootDir),], resource),
        enableFindWidget: true, });

    let html = fs.readFileSync(path.join(resourceRootDir, 'cnxml-preview.html'), 'utf-8');
    html = addBaseHref(panel.webview, resource, html);
    html = fixResourceReferences(panel.webview, html, resourceRootDir);
    html = fixCspSourceReferences(panel.webview, html);
    panel.webview.html = html;

    const xml = contents;
    panel.webview.postMessage({xml});
    let throttleTimer = setTimeout(updatePreview, 200);

    async function updatePreview() {
      clearTimeout(throttleTimer);
      let document: vscode.TextDocument;
      if (!resource) {return;} // it will never be empty at this point
      try {
        document = await vscode.workspace.openTextDocument(resource);
      } catch {
        return;
      }
      const newContents = document.getText();
      if (contents !== newContents) {
        contents = newContents;
        panel.webview.postMessage({xml: contents});
      }
      throttleTimer = setTimeout(updatePreview, 200);
    }

    // https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing
    panel.webview.onDidReceiveMessage(async (message) => {
      // Replace the full-source version with what came out of the preview panel
      if (!resource) { return; } // it will never be empty at this point
      try {
        const document = await vscode.workspace.openTextDocument(resource);
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(resource, fullRange, message.xml);
        vscode.workspace.applyEdit(edit);
      } catch { }
    });
  };
}