# VSCode Extension that runs in gitpod
[![Coverage Status](https://img.shields.io/codecov/c/github/openstax/poet.svg)](https://codecov.io/gh/openstax/poet)

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

1. Upload the `.vsix` file to your workspace
1. Right click on the uploaded file, and select "Install Extension VSIX"
1. If prompted to do so, reload the browser
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

## Developing / Debugging with the language server

Our extension incorporates a language server which can be debugged using:

* Debug / console messages which get displayed in the editor after being passed to the extension over the language server protocol
* Collecting and analyzing traces of the language server protocol communication between the extension and language server (refer to the [LSP specification](https://microsoft.github.io/language-server-protocol/specifications/specification-current/))
* Debugging in a local VS code environment by attaching to the language server, setting breakpoints, etc.

### Language server console messages

The language server code can be instrumented with `connection.console.log()` to send logging / debug output to the extension. This information can be inspected by opening the Output window labeled "CNXML Language Server" once the extension is activated. This works when running the extension in a local VS Code debug environment or on gitpod.

### LSP traces

The `vscode-languageclient` library supports generating traces of the language server protocol communication between the extension and language server. By default, this output is disabled. It can be enabled in any environment by adding the following to the `settings.json` configuration where the extension is running (e.g. in a gitpod workspace or the workspace opened in a local extension session):

```json
"languageServerCnxml.trace.server": "verbose"
```

The trace data is then added to the Output window labeled "CNXML Language Server". It can be visualized using the [language-server-protocol-inspector](https://github.com/Microsoft/language-server-protocol-inspector). The following steps assume:

1. You have copied the output data into a local `trace.log` file
2. You are using node <= 10 (more recent versions of node seem to be problematic)

```bash
$ git clone https://github.com/Microsoft/language-server-protocol-inspector
$ cd language-server-protocol-inspector/lsp-inspector
$ yarn
$ yarn serve
```

You can then open `http://localhost:8082/` in your browser, upload your `trace.log` file, and select it to view the visualized / parsed output.

### Debugging language server code with VS Code

There is a launch configuration to attach to the language server which can be used during local development. Since the language server is launched by the extension itself, the following sequence of steps should be used:

1. Execute "Run Extension" from the Run view
1. Once the extension is launched, execute "Attach to Language Server" from the Run view

You can now set breakpoints, etc. in the server source code.
