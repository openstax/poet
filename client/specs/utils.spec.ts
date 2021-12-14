import expect from 'expect'
import Sinon from 'sinon'
import mockfs from 'mock-fs'
import vscode, { Uri, Webview } from 'vscode'
import { addBaseHref, fixResourceReferences, fixCspSourceReferences, ensureCatch, ensureCatchPromise, expect as expectOrig, getErrorDiagnosticsBySource, populateXsdSchemaFiles, configureWorkspaceSettings } from '../src/utils'
import { Panel } from '../src/panel'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

const TEST_OUT_DIR = join(__dirname, '../static') // contains 'xsd/' dir

describe('expectValue', () => {
  it('unwraps non-null', () => {
    const maybe: string | null = 'test'
    expect(() => { expectOrig(maybe, 'message') }).not.toThrow()
  })
  it('throws on null', async () => {
    const maybe: string | null = null
    expect(() => { expectOrig(maybe, 'message') }).toThrow()
  })
  it('throws on null with custom message', async () => {
    const maybe: string | null = null
    expect(() => { expectOrig(maybe, 'my-message') }).toThrow('my-message')
  })
})

describe('tests with sinon', () => {
  const sinon = Sinon.createSandbox()
  afterEach(() => sinon.restore())

  describe('ensureCatch', () => {
    it('ensureCatch throws when its argument throws', async () => {
      const errMessage = 'I am an error'
      async function fn(): Promise<void> { throw new Error(errMessage) }
      const s = sinon.spy(vscode.window, 'showErrorMessage')
      const wrapped = ensureCatch(fn)

      await expect(async () => await wrapped()).rejects.toThrow(errMessage)
      // Verify that a message was sent to the user
      expect(s.callCount).toBe(1)
    })
    it('ensureCatchPromise throws when its argument rejects', async () => {
      const errMessage = 'I am an error'
      async function fn(): Promise<void> { throw new Error(errMessage) }
      const s = sinon.spy(vscode.window, 'showErrorMessage')
      const promise = fn()

      await expect(async () => await ensureCatchPromise(promise)).rejects.toThrow(errMessage)
      // Verify that a message was sent to the user
      expect(s.callCount).toBe(1)
    })
  })

  describe('webview HTML modifiers', () => {
    let webview = undefined as unknown as Webview
    let asWebviewUri = undefined as unknown as (uri: Uri) => Uri
    beforeEach(() => {
      asWebviewUri = sinon.stub().returns(Uri.parse('scheme:vscode-webview/root/some-path'))
      webview = { cspSource: 'scheme:vscode-webview/root', asWebviewUri } as unknown as Webview
    })
    it('addBaseHref', () => {
      const resource = Uri.parse('file://path/to/page')
      // eslint-disable-next-line no-template-curly-in-string
      const html = '<document><base href="${BASE_URI}"/></document>'
      const modified = addBaseHref(webview, resource, html)
      expect(modified.includes('vscode-webview')).toBe(true)
    })
    it('fixResourceReferences relative', () => {
      const resourceRootDir = '/fake/path'
      const html = '<document><a href="./media/some-image.jpg"></a></document>'
      const modified = fixResourceReferences(webview, html, resourceRootDir)
      expect(modified.includes('vscode-webview')).toBe(true)
    })
    it('fixResourceReferences non-relative', () => {
      const resourceRootDir = '/fake/path'
      const html = '<document><a href="media/some-image.jpg"></a></document>'
      const modified = fixResourceReferences(webview, html, resourceRootDir)
      expect(modified).toEqual(html) // No change when no './' before href
    })
    it('fixCspSourceReferences', () => {
      // eslint-disable-next-line no-template-curly-in-string
      const html = '<document><meta content="${WEBVIEW_CSPSOURCE}"</meta></document>'
      const modified = fixCspSourceReferences(webview, html)
      expect(modified.includes('vscode-webview')).toBe(true)
    })
    it('injectEnsuredMessages no body is noop', () => {
      const html = '<html></html>'
      expect(Panel.prototype.injectInitialState(html, { test: 'abc' })).toBe(html)
    })
    it('injectEnsuredMessages injects messages', () => {
      const html = '<html><body></body></html>'
      const result = Panel.prototype.injectInitialState(html, { test: 'abc' })
      expect(result.includes('script')).toBe(true)
      expect(result.includes('{"test":"abc"}')).toBe(true)
    })
  })

  it('getErrorDiagnostics returns expected errors', async () => {
    const file1Uri = { path: '/test1.cnxml', scheme: 'file' } as any as vscode.Uri
    const file1Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source1' } as any as vscode.Diagnostic
    const file1Diag2 = { severity: vscode.DiagnosticSeverity.Error, source: 'source2' } as any as vscode.Diagnostic
    const file1Diag3 = { severity: vscode.DiagnosticSeverity.Warning, source: 'source2' } as any as vscode.Diagnostic
    const file2Uri = { path: '/test2.cnxml', scheme: 'file' } as any as vscode.Uri
    const file2Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source2' } as any as vscode.Diagnostic
    const file2Diag2 = { severity: vscode.DiagnosticSeverity.Error, source: undefined } as any as vscode.Diagnostic
    const testDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
      [file1Uri, [file1Diag1, file1Diag2, file1Diag3]],
      [file2Uri, [file2Diag1, file2Diag2]]
    ]
    sinon.stub(vscode.languages, 'getDiagnostics').returns(testDiagnostics)
    const errorsBySource = getErrorDiagnosticsBySource()
    const expected = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
    expected.set('source1', [[file1Uri, file1Diag1]])
    expected.set('source2', [[file1Uri, file1Diag2], [file2Uri, file2Diag1]])
    expect(errorsBySource).toEqual(expected)
  })

  describe('populateXsdSchemaFiles', () => {
    const ROOT_FOR_LOADING = '/root-for-loading'
    const WORKSPACE_ROOT = '/workspace-root'
    function stubWorkspaceRoot() {
      sinon.stub(vscode.workspace, 'workspaceFolders').get(() => [{ uri: Uri.file(WORKSPACE_ROOT) }])
    }
    beforeEach(() => {
      const fs: any = {}
      fs[WORKSPACE_ROOT] = { /* empty dir */ }
      fs[ROOT_FOR_LOADING] = mockfs.load(TEST_OUT_DIR)
      mockfs(fs)

      // Stub the XML extension
      const fakeXmlExtension: vscode.Extension<any> = {
        activate: sinon.stub().resolves({
          addXMLCatalogs: (catalogs: string[]): void => {}
        })
      } as any as vscode.Extension<any>
      sinon.stub(vscode.extensions, 'getExtension').withArgs('redhat.vscode-xml').returns(fakeXmlExtension)
    })
    afterEach(() => mockfs.restore())

    it('schema files are populated when not existing', async () => {
      const schemaPath = join(WORKSPACE_ROOT, '.xsd')
      expect(existsSync(schemaPath)).toBe(false)
      stubWorkspaceRoot()
      await populateXsdSchemaFiles(ROOT_FOR_LOADING)
      expect(existsSync(schemaPath)).toBe(true)
      expect(existsSync(join(schemaPath, 'catalog.xml'))).toBe(true)
    })
    it('schema files are replaced when they exist', async () => {
      const schemaPath = join(WORKSPACE_ROOT, '.xsd')
      const testXsdPath = join(schemaPath, 'foo.xsd')
      expect(existsSync(WORKSPACE_ROOT)).toBe(true)
      expect(existsSync(schemaPath)).toBe(false)
      mkdirSync(schemaPath)
      writeFileSync(testXsdPath, 'test')
      expect(existsSync(testXsdPath)).toBe(true)
      stubWorkspaceRoot()
      await populateXsdSchemaFiles(ROOT_FOR_LOADING)
      expect(existsSync(testXsdPath)).toBe(false)
    })
    it('schema-generation does not run when there is no workspace', async () => {
      sinon.stub(vscode.workspace, 'workspaceFolders').get(() => undefined)
      await populateXsdSchemaFiles('')
    })
  })

  describe('configureWorkspaceSettings', () => {
    it('reloads settings', async () => {
      const getStub = sinon.stub().returns({ '*.cnxml': 'xml' })
      const updateStub = sinon.stub().resolves()
      sinon.stub(vscode.workspace, 'getConfiguration').returns({
        get: getStub,
        has: sinon.stub().returns(false),
        inspect: sinon.stub().returns({}),
        update: updateStub
      })

      await configureWorkspaceSettings()

      getStub.returns({})
      await configureWorkspaceSettings()

      const updateCalls = updateStub.getCalls()
      expect(updateCalls.length).toBe(4)
      // Make sure the property is set to '', then anything other than ''
      expect(updateCalls[0].args[1] === '').toBe(true)
      expect(updateCalls[0].args[2] === vscode.ConfigurationTarget.Workspace).toBe(true)

      expect(updateCalls[1].args[1] !== '').toBe(true)
      expect(updateCalls[1].args[2] === vscode.ConfigurationTarget.Workspace).toBe(true)

      expect(updateCalls[2].args[1] === '').toBe(true)
      expect(updateCalls[2].args[2] === vscode.ConfigurationTarget.Workspace).toBe(true)

      expect(updateCalls[3].args[1] !== '').toBe(true)
      expect(updateCalls[3].args[2] === vscode.ConfigurationTarget.Workspace).toBe(true)

      expect(updateStub.alwaysCalledWith('files.associations')).toBe(true)
      expect(getStub.alwaysCalledWith('files.associations')).toBe(true)
    })
  })
})
