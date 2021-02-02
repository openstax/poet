import vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri } from './utils';

export function showImageUpload(resourceRootDir: string) {
  return async () => {
    const panel = vscode.window.createWebviewPanel(
      "openstax.imageUpload",
      "ImageUpload",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      },
    );
  
    let html = fs.readFileSync(path.join(resourceRootDir, 'image-upload.html'), 'utf-8');
    html = fixResourceReferences(panel.webview, html, resourceRootDir);
    html = fixCspSourceReferences(panel.webview, html);
    panel.webview.html = html;
  
    panel.reveal(vscode.ViewColumn.One);
  
    panel.webview.onDidReceiveMessage(async (message) => {
      const { mediaUploads } = message;
      const uri = getRootPathUri();
      if (mediaUploads == null || uri == null) {
        return;
      }
      for (const upload of mediaUploads) {
        const { mediaName, data } = upload;
        // vscode.Uri.joinPath is not in the latest theia yet
        // const newFileUri = vscode.Uri.joinPath(uri, 'media', mediaName);
        const newFileUri = uri.with({ path: path.join(uri.path, 'media', mediaName) });
        try {
          await vscode.workspace.fs.stat(newFileUri);
          // File exists already, do nothing for now
        } catch (err) {
          if (err instanceof vscode.FileSystemError && err.name.includes('EntryNotFound')) {
            console.log(`writing: ${newFileUri.toString()}`);
            const content = Buffer.from(data.split(',')[1], 'base64');
            vscode.workspace.fs.writeFile(newFileUri, content);
          }
        }
      }
    });
  };
}