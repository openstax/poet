# VSCode Extension that runs in gitpod/Theia

![installing and enabling the preview](./editor.gif)

## Dev instructions
1. open this directory in VSCode.
1. Run `npm install`
1. Run `npm run webpack:watch` (this will continue running / recompiling as you make changes)
1. Launch the "Run Extension" task
1. Open an XML file
1. Click the Show Preview button on the top-right of the editor
    - If you do not see it that is because it is invisible because we have not created an icon. Open a Markdown file, take note of where the icon is, and then click in the same area when viewing the CNXML file

For debugging, open the webview developer tools by opening the command pallete and selecting `Developer: Open Webview Developer Tools`. This will allow you to inspect the webview contents. **Note:** It can only be opened when the webview is open.

## Enabling the Code editor for Gitpod

Go to your [settings](https://gitpod.io/settings/) view and select "Enable Feature Preview". Then, you can choose Code as your Default IDE (or switch back to Theia). The change will be reflected in any new workspace you create.

## How to create the .vsix extension for Theia or gitpod

1. Update the version in `package.json` if desired (e.g. to associate with an issue, `0.0.0-dev-cnx1234`)
1. `npm run package`

## How to upload the .vsix extension to gitpod (Theia editor)

An extension package file can be tested by manually uploading to a gitpod workspace running the Theia editor using the following steps:

1. In the terminal on the workspace, run `rm -f .gitpod.yml`
1. Reload the browser window
1. Click on the [Extensions panel](https://www.gitpod.io/docs/vscode-extensions/) and drag your `.vsix` file into the "Installed for this project" section
1. Run `cat .gitpod.yml` to confirm the version in the file looks correct
1. Reload the browser window

Note: Sometimes the package will end up appearing under "Installed for User" after these steps. It's not clear why.

## How to upload the .vsix extension to gitpod (Code editor)

If you are using the Code editor, the manual package update steps are:

1. Go to the extensions tab, and under Installed select our package. Click the gear icon and select "Uninstall".
1. Reload the browser
1. Upload the `.vsix` file to your workspace
1. Go to the Extensions tab. Just above and to the right of the "Search Extensions in Marketplace", you'll see `...` which will open a dropdown. Select "Install from VSIX..." in that menu.
1. Enter the path with your repo and package file as `/workspace/{repo}/{package}`. For example, if you're working in `university-physics` and the package is `editor-0.0.0-dev.vsix`, the path where you uploaded the file to your workspace will be `/workspace/university-physics/editor-0.0.0-dev.vsix`.
1. Delete the package file from your workspace

## Activating the extension

Currently our extension will activate when it detects an XML file. If it doesn't exist already, you can populate the following in your `settings.json` to associate `.cnxml` files as XML:

```json
{
    "files.associations": {
        "*.cnxml": "xml"
    }
}
```

In a Theia editor, this file should be `.theia/settings.json` in your workspace, and for VS code it should be `.vscode/settings.json`. Once set, you can open any CNXML file and the extension should load.
