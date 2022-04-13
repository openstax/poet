const {URI} = require('vscode-uri')

const REQUIRED_VSCODE_VERSION = '1.52.0'
const appName = 'VSCODE_MOCK?'
const languages = {
  getDiagnostics: jest.fn(),
  createDiagnosticCollection: jest.fn(),
  registerCompletionItemProvider: () => new Disposable(),
  registerDocumentLinkProvider: () => new Disposable(),
};

const StatusBarAlignment = {};

const window = {
  createOutputChannel: (() => ({
    dispose: jest.fn(),
    append: jest.fn(),
    appendLine: jest.fn(),
    show: jest.fn(),
  })),
  createTreeView: jest.fn(),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(() => Promise.resolve()),
  createWebviewPanel: jest.fn(() => ({
    dispose: jest.fn(),
    onDidDispose: jest.fn(),
    webview: {
      html: '',
      postMessage: jest.fn(),
      asWebviewUri: jest.fn(() => 'fake-webview-uri'),
      onDidReceiveMessage: () => new Disposable(),
    }
  })),
  showInputBox: jest.fn(() => Promise.resolve()),
  activeTextEditor: undefined,
  withProgress: jest.fn(),
  showTextDocument: jest.fn(),
  onDidChangeActiveTextEditor: jest.fn(),
  onDidChangeTextEditorVisibleRanges: jest.fn(),
};

const workspace = {
  textDocuments: [],
  getConfiguration: jest.fn(() => ({
    get: jest.fn((section, defaultValue) => defaultValue),
    has: jest.fn(),
    inspect: jest.fn(),
    update: jest.fn()
  })),
  workspaceFolders: [],
  createFileSystemWatcher: jest.fn(() => ({
    onDidCreate: jest.fn(),
    onDidChange: jest.fn(),
    onDidDelete: jest.fn(),
  })),
  onDidChangeConfiguration: jest.fn(),
  onDidChangeWorkspaceFolders: jest.fn(),
  onDidOpenTextDocument: jest.fn(),
  onDidChangeTextDocument: jest.fn(),
  onWillSaveTextDocument: jest.fn(),
  onDidCloseTextDocument: jest.fn(),
  onDidSaveTextDocument: jest.fn(),
  findFiles: jest.fn(),
};

const extensions = {
  getExtension: jest.fn(),
}

const commands = {
  executeCommand: jest.fn(),
  registerCommand: jest.fn(),
}

const Range = jest.fn();
const Diagnostic = jest.fn();
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

const debug = {
  onDidTerminateDebugSession: jest.fn(),
  startDebugging: jest.fn(),
};

const TreeItemCollapsibleState = {
  None: "None",
  Expanded: "Expanded",
  Collapsed: "Collapsed",
};

class Disposable {
  constructor(fn) { this.fn = fn }
  dispose() { if (this.fn) this.fn() }
}
class TreeItem {}

class EventEmitter {
  listeners = []
  event = (listener) => {
    const disposable = new Disposable()
    this.listeners.push({ listener, disposable })
    return disposable
  }
  fire(...args) {
    this.listeners.forEach(({ listener }) => listener(...args))
  }
  dispose() {
    this.listeners.forEach(({ disposable }) => disposable.dispose(...args))
  }
}

class CompletionItem {}
class CodeLens {}
class DocumentLink {}
class CodeAction {}
class CallHierarchyItem {}

class ThemeIcon {
  static File = 'File'
  static Folder = 'Folder'
}
class CodeActionKind {
    static Empty = 'Empty'
    static QuickFix = 'QuickFix'
    static Refactor = 'Refactor'
    static RefactorExtract = 'RefactorExtract'
    static RefactorInline = 'RefactorInline'
    static RefactorRewrite = 'RefactorRewrite'
    static Source = 'Source'
    static SourceOrganizeImports = 'SourceOrganizeImports'
}

const ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1,
    Two: 2,
    Three: 3,
    Four: 4,
    Five: 5,
    Six: 6,
    Seven: 7,
    Eight: 8,
    Nine: 9,
}

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }

const ProgressLocation = {
  /**
   * Show progress for the source control viewlet, as overlay for the icon and as progress bar
   * inside the viewlet (when visible). Neither supports cancellation nor discrete progress.
   */
  SourceControl: 1,

  /**
   * Show progress in the status bar of the editor. Neither supports cancellation nor discrete progress.
   */
  Window: 10,

  /**
   * Show progress as notification with an optional cancel button. Supports to show infinite and discrete progress.
   */
  Notification: 15
}

const vscode = {
  version: REQUIRED_VSCODE_VERSION,
  languages,
  commands,
  window,
  workspace,
  extensions,
  env: { appName },
  StatusBarAlignment,
  ViewColumn,
  Uri: URI,
  Disposable,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  debug,
  commands,
  TreeItemCollapsibleState,
  TreeItem,
  EventEmitter,
  CompletionItem,
  CodeLens,
  DocumentLink,
  CodeAction,
  CodeActionKind,
  CallHierarchyItem,
  ThemeIcon,
  ConfigurationTarget,
  ProgressLocation,
};

module.exports = { ...vscode, default: vscode };