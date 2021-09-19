const {URI} = require('vscode-uri')

const REQUIRED_VSCODE_VERSION = '1.52.0'
const appName = 'VSCODE_MOCK?'
const languages = {
  createDiagnosticCollection: jest.fn(),
  registerCompletionItemProvider: () => new Disposable(),
  registerDocumentLinkProvider: () => new Disposable(),
};

const StatusBarAlignment = {};

const window = {
  createOutputChannel: (() => ({ // jest.fn(() => ({
    dispose: jest.fn(),
    append: jest.fn(),
    appendLine: jest.fn(),
    show: jest.fn(),
  })),
  // createStatusBarItem: jest.fn(() => ({
  //   show: jest.fn(),
  // })),
  createTreeView: jest.fn(),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(() => Promise.resolve()),
  // showWarningMessage: jest.fn(),
  // createTextEditorDecorationType: jest.fn(),
  // registerFileDecorationProvider: jest.fn(),
};

const workspace = {
  textDocuments: [],
  getConfiguration: jest.fn(),
  // workspaceFolders: [],
  // onDidSaveTextDocument: jest.fn(),
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
};

const commands = {
  executeCommand: jest.fn(),
  registerCommand: jest.fn(),
}

// const OverviewRulerLane = {
//   Left: null,
// };

// const Uri = {
//   file: (f) => f,
//   parse: jest.fn(),
// };
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
  dispose() {}
}
class TreeItem {}

class EventEmitter {
  get event() { return jest.fn() }
  fire() {}
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

const vscode = {
  version: REQUIRED_VSCODE_VERSION,
  languages,
  commands,
  window,
  workspace,
  env: { appName },
  StatusBarAlignment,
  // OverviewRulerLane,
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
};

module.exports = vscode;