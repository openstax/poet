# VSCode Extension that runs in gitpod/Theia

![installing and enabling the preview](./editor.gif)

## Dev instructions
1. open this directory in VSCode.
1. Launch the "Run Extension" task
1. Open an XML file
1. Click the Show Preview button on the top-right of the editor
    - If you do not see it that is because it is invisible because we have not created an icon. Open a Markdown file, take note of where the icon is, and then click in the same area when viewing the CNXML file

For debugging, open the webview developer tools by opening the command pallete and selecting `Developer: Open Webview Developer Tools`. This will allow you to inspect the webview contents. **Note:** It can only be opened when the webview is open.

## How to create the .vsix extension for Theia or gitpod

1. `npm run package`
1. Open the Extensions panel on [gitpod.io](https://gitpod.io)
1. Drag-and-drop the `.vsix` file [into the Extensions panel](https://www.gitpod.io/docs/vscode-extensions/) to install it.