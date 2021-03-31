import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import {
  parseXMLString,
  validateImagePaths,
  validateLinks,
  DIAGNOSTIC_SOURCE,
  IMAGEPATH_DIAGNOSTIC_CODE,
  LINK_DIAGNOSTIC_CODE,
  getCurrentModules,
  ValidationQueue,
  ValidationRequest,
  ModuleInformation,
  calculateElementPositions,
  expect as expectOrig
} from './../utils'

import assert from 'assert'
import mockfs from 'mock-fs'
import sinon from 'sinon'
import * as xpath from 'xpath-ts'
import {
  Diagnostic,
  DiagnosticSeverity,
  FileChangeType,
  Position
} from 'vscode-languageserver'
import { cacheEquals, cachify, cacheSort, cacheListsEqual, cacheArgsEqual, BookBundle, ModuleTitle, recachify } from '../book-bundle'
import { TocTreeCollection } from '../../../common/src/toc-tree'

function expect<T>(value: T | null | undefined): T {
  return expectOrig(value, 'test_assertion')
}

describe('parseXMLString', function () {
  it('should return null on a new / empty XML', async function () {
    const inputContent = ''
    const inputDocument = TextDocument.create('', '', 0, inputContent)
    const result = parseXMLString(inputDocument)
    assert.strictEqual(result, null)
  })
  it('should return an object on valid XML', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content></content>
      </document>
    `
    const inputDocument = TextDocument.create('', '', 0, inputContent)
    const result = parseXMLString(inputDocument)
    assert(result instanceof Object)
  })
})

describe('validateImagePaths', function () {
  before(function () {
    mockfs({
      '/media/image1.jpg': ''
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return empty diagnostics when no images', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content></content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateImagePaths(inputDocument, xmlData)
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics when all images are valid', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <image src="../../media/image1.jpg" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateImagePaths(inputDocument, xmlData)
    assert.deepStrictEqual(result, [])
  })
  it('should return diagnostics when images are invalid', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <image src="../../media/image1.jpg" />
          <image src="../../media/image2.jpg" />
          <image src="../../media/image3.jpg" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateImagePaths(inputDocument, xmlData)
    const image2Location = inputContent.indexOf('<image src="../../media/image2.jpg"')
    const image3Location = inputContent.indexOf('<image src="../../media/image3.jpg"')
    const expectedDiagnostic1: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image2Location),
        end: inputDocument.positionAt(image2Location + '<image src="../../media/image2.jpg" />'.length)
      },
      message: 'Image file ../../media/image2.jpg doesn\'t exist!',
      code: IMAGEPATH_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image3Location),
        end: inputDocument.positionAt(image3Location + '<image src="../../media/image3.jpg" />'.length)
      },
      message: 'Image file ../../media/image3.jpg doesn\'t exist!',
      code: IMAGEPATH_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic1, expectedDiagnostic2])
  })
  it('should return correct diagnostics with duplicate invalid images', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <image src="../../media/image2.jpg" />
          <image src="../../media/image2.jpg" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateImagePaths(inputDocument, xmlData)
    const image2Location = inputContent.indexOf('<image src="../../media/image2.jpg"')
    const image2DupLocation = inputContent.lastIndexOf('<image src="../../media/image2.jpg"')
    const expectedDiagnostic1: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image2Location),
        end: inputDocument.positionAt(image2Location + '<image src="../../media/image2.jpg" />'.length)
      },
      message: 'Image file ../../media/image2.jpg doesn\'t exist!',
      code: IMAGEPATH_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image2DupLocation),
        end: inputDocument.positionAt(image2DupLocation + '<image src="../../media/image2.jpg" />'.length)
      },
      message: 'Image file ../../media/image2.jpg doesn\'t exist!',
      code: IMAGEPATH_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic1, expectedDiagnostic2])
  })
  it('should ignore incomplete image elements', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <image src="../../media/image1.jpg" />
          <image />
          <image src="" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateImagePaths(inputDocument, xmlData)
    assert.deepStrictEqual(result, [])
  })
})

describe('getCurrentModules', function () {
  before(function () {
    mockfs({
      '/workspace/modules/m00001/index.cnxml': '',
      '/workspace/modules/m00002/index.cnxml': '',
      '/emptyworkspace': ''
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return module paths found in workspace', async function () {
    const workspaceFolder = {
      index: 0,
      name: '',
      uri: 'file:///workspace'
    }
    const result = await getCurrentModules([workspaceFolder])
    const expected = new Map<string, ModuleInformation>()
    expected.set('m00001', { path: '/workspace/modules/m00001/index.cnxml' })
    expected.set('m00002', { path: '/workspace/modules/m00002/index.cnxml' })
    assert.deepStrictEqual(result, expected)
  })
  it('should return empty data if modules directory doesn\'t exist', async function () {
    const workspaceFolder = {
      index: 0,
      name: '',
      uri: 'file:///emptyworkspace'
    }
    const result = await getCurrentModules([workspaceFolder])
    assert.deepStrictEqual(result, new Map<string, ModuleInformation>())
  })
})

describe('validateLinks', function () {
  before(function () {
    mockfs({
      '/modules/m00001/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <content>
            <para id="para1"></para>
            <para id="dup"></para>
            <para id="dup"></para>
          </content>
        </document>
      `,
      '/modules/empty/index.cnxml': ''
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return empty diagnostics when no links', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content></content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, new Map<string, ModuleInformation>())
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics links are incomplete', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link target-id="" />
          <link document="" />
          <link document="" target-id="" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, new Map<string, ModuleInformation>())
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics when all links are valid', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link target-id="para1" />
          <link document="m00001" />
          <para id="para1"></para>
          <para id=""></para>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const moduleInformation: ModuleInformation = {
      path: '/modules/m00001/index.cnxml'
    }
    const knownModules = new Map<string, ModuleInformation>()
    knownModules.set('m00001', moduleInformation)
    const result = await validateLinks(xmlData, knownModules)
    assert.deepStrictEqual(result, [])
  })
  it('should return diagnostic when same-page target-id doesn\'t exist', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link target-id="para1" />
          <link target-id="para2" />
          <para id="para1"></para>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, new Map<string, ModuleInformation>())
    const linkLocation = inputContent.indexOf('<link target-id="para2"')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link target-id="para2" />'.length)
      },
      message: 'Target for link doesn\'t exist!: para2',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostic when same-page target-id is duplicated', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link target-id="para1" />
          <para id="para1"></para>
          <para id="para1"></para>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, new Map<string, ModuleInformation>())
    const linkLocation = inputContent.indexOf('<link target-id="para1"')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link target-id="para1" />'.length)
      },
      message: 'Target for link is not unique!: para1',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostic when target document does not exist', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link document="m00002" />
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, new Map<string, ModuleInformation>())
    const linkLocation = inputContent.indexOf('<link document="m00002"')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link document="m00002" />'.length)
      },
      message: 'Target document for link doesn\'t exist!: m00002',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostic when target document exists but ID does not', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link document="m00001" target-id="para1"/>
          <link document="m00001" target-id="para2"/>
          <link target-id="para1" />
          <para id="para1"></para>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const moduleInformation: ModuleInformation = {
      path: '/modules/m00001/index.cnxml'
    }
    const knownModules = new Map<string, ModuleInformation>()
    knownModules.set('m00001', moduleInformation)
    const result = await validateLinks(xmlData, knownModules)
    const linkLocation = inputContent.indexOf('<link document="m00001" target-id="para2"/>')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link document="m00001" target-id="para2"/>'.length)
      },
      message: 'Target ID in document doesn\'t exist!: para2',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostic when target document uses duplicated ID', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link document="m00001" target-id="dup"/>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const moduleInformation: ModuleInformation = {
      path: '/modules/m00001/index.cnxml'
    }
    const knownModules = new Map<string, ModuleInformation>()
    knownModules.set('m00001', moduleInformation)
    const result = await validateLinks(xmlData, knownModules)
    const linkLocation = inputContent.indexOf('<link document="m00001" target-id="dup"/>')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link document="m00001" target-id="dup"/>'.length)
      },
      message: 'Target ID in document is not unique!: dup',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostic when target document exists but is empty and link uses ID', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link document="empty" target-id="para1"/>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const moduleInformation: ModuleInformation = {
      path: '/modules/empty/index.cnxml'
    }
    const knownModules = new Map<string, ModuleInformation>()
    knownModules.set('empty', moduleInformation)
    const result = await validateLinks(xmlData, knownModules)
    const linkLocation = inputContent.indexOf('<link document="empty" target-id="para1"/>')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(linkLocation),
        end: inputDocument.positionAt(linkLocation + '<link document="empty" target-id="para1"/>'.length)
      },
      message: 'Could not parse target document!: empty',
      code: LINK_DIAGNOSTIC_CODE,
      source: DIAGNOSTIC_SOURCE
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
})

describe('ValidationQueue', function () {
  const connection: any = {}

  it('should queue requests when added', async function () {
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument = TextDocument.create('', '', 0, '')
    sinon.stub(validationQueue, 'processQueue' as any)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: ValidationRequest = {
      textDocument: inputDocument,
      version: inputDocument.version
    }

    validationQueue.addRequest(validationRequest)
    assert.strictEqual((validationQueue as any).queue.length, 1)

    sinon.restore()
  })
  it('should drop old version when adding requests', async function () {
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument1v0 = TextDocument.create('file:///test1.cnxml', '', 0, '')
    const inputDocument1v1 = TextDocument.create('file:///test1.cnxml', '', 1, '')
    const inputDocument2v0 = TextDocument.create('file:///test2.cnxml', '', 0, '')
    const documents: TextDocument[] = [inputDocument1v0, inputDocument1v1, inputDocument2v0]
    sinon.stub(validationQueue, 'processQueue' as any)
    sinon.stub(validationQueue, 'trigger' as any)

    documents.forEach(element => {
      const validationRequest: ValidationRequest = {
        textDocument: element,
        version: element.version
      }
      validationQueue.addRequest(validationRequest)
    })

    assert.strictEqual((validationQueue as any).queue.length, 2)
    const entry0 = (validationQueue as any).queue[0]
    const entry1 = (validationQueue as any).queue[1]
    assert.strictEqual(entry0.textDocument.uri, inputDocument1v1.uri)
    assert.strictEqual(entry0.version, inputDocument1v1.version)
    assert.strictEqual(entry1.textDocument.uri, inputDocument2v0.uri)
    assert.strictEqual(entry1.version, inputDocument2v0.version)

    sinon.restore()
  })
  it('should self-invoke trigger() when adding requests', async function () {
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument = TextDocument.create('', '', 0, '')
    sinon.stub(validationQueue, 'processQueue' as any)
    const triggerStub = sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: ValidationRequest = {
      textDocument: inputDocument,
      version: inputDocument.version
    }

    validationQueue.addRequest(validationRequest)
    assert(triggerStub.calledOnce)

    sinon.restore()
  })
  it('should queue requests when triggering processing', async function () {
    const clock = sinon.useFakeTimers()
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument1 = TextDocument.create('file:///test1.cnxml', '', 0, '')
    const inputDocument2 = TextDocument.create('file:///test2.cnxml', '', 0, '')
    const inputDocument3 = TextDocument.create('file:///test3.cnxml', '', 0, '')
    const inputDocument4 = TextDocument.create('file:///test4.cnxml', '', 0, '')
    const documents: TextDocument[] = [
      inputDocument1, inputDocument2, inputDocument3, inputDocument4
    ]

    documents.forEach(element => {
      const validationRequest: ValidationRequest = {
        textDocument: element,
        version: element.version
      }
      validationQueue.addRequest(validationRequest)
    })

    // All of the requests should still be in the queue
    assert.strictEqual((validationQueue as any).queue.length, 4)
    // Advance the event loop and ensure the queue is consumed
    clock.next()
    assert.strictEqual((validationQueue as any).queue.length, 3)
    sinon.restore()
  })
  it('should remove queue entries when processing', async function () {
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument = TextDocument.create('', '', 0, '')
    const workspaceFoldersStub = sinon.stub().resolves(null)
    sinon.stub(validationQueue, 'trigger' as any).callsFake(
      function () {
        (validationQueue as any).processQueue()
      }
    )
    connection.workspace = {
      getWorkspaceFolders: workspaceFoldersStub
    } as any

    const validationRequest: ValidationRequest = {
      textDocument: inputDocument,
      version: inputDocument.version
    }

    validationQueue.addRequest(validationRequest)
    assert.strictEqual((validationQueue as any).queue.length, 0)

    sinon.restore()
  })
  it('should send diagnostics when processing document', async function () {
    const validationQueue: ValidationQueue = new ValidationQueue(connection)
    const inputDocument = TextDocument.create('', '', 0, '<document></document>')
    const sendDiagnosticsStub = sinon.stub()
    sinon.stub(validationQueue, 'trigger' as any)

    connection.sendDiagnostics = sendDiagnosticsStub

    const validationRequest: ValidationRequest = {
      textDocument: inputDocument,
      version: inputDocument.version
    }

    validationQueue.addRequest(validationRequest)
    await (validationQueue as any).processQueue()
    assert.strictEqual(sendDiagnosticsStub.callCount, 1)
    sinon.restore()
  })
})

describe('calculateElementPositions', function () {
  it('should return start and end positions using siblings when available', async function () {
    const xmlContent = `
      <document>
        <content>
          <image src="" />
        </content>
      </document>
    `
    const document = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, xmlContent
    )
    const xmlData = parseXMLString(document)
    assert(xmlData != null)
    const elements = xpath.select('//image', xmlData) as Node[]
    const imageElement = elements[0] as Element

    assert(imageElement.nextSibling != null)
    const expectedStart: Position = {
      line: 3,
      character: 10
    }
    const expectedEnd: Position = {
      line: 3,
      character: 26
    }
    const result: Position[] = calculateElementPositions(imageElement)
    assert.deepStrictEqual(result, [expectedStart, expectedEnd])
  })
  it('should return start and end positions based on attributes when no siblings', async function () {
    const xmlContent = `
      <document>
        <content><image src="value" /></content>
      </document>
    `
    const document = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, xmlContent
    )
    const xmlData = parseXMLString(document)
    assert(xmlData != null)
    const elements = xpath.select('//image', xmlData) as Node[]
    const imageElement = elements[0] as Element

    assert(imageElement.nextSibling === null)
    const expectedStart: Position = {
      line: 2,
      character: 17
    }
    const expectedEnd: Position = {
      line: 2,
      character: 35
    }
    const result: Position[] = calculateElementPositions(imageElement)
    assert.deepStrictEqual(result, [expectedStart, expectedEnd])
  })
  it('should return start and end positions based on tag when no siblings or attributes', async function () {
    const xmlContent = `
      <document>
        <content><image /></content>
      </document>
    `
    const document = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, xmlContent
    )
    const xmlData = parseXMLString(document)
    assert(xmlData != null)
    const elements = xpath.select('//image', xmlData) as Node[]
    const imageElement = elements[0] as Element

    assert(imageElement.nextSibling === null)
    const expectedStart: Position = {
      line: 2,
      character: 17
    }
    const expectedEnd: Position = {
      line: 2,
      character: 23
    }
    const result: Position[] = calculateElementPositions(imageElement)
    assert.deepStrictEqual(result, [expectedStart, expectedEnd])
  })
})
describe('BookBundle', () => {
  before(function () {
    mockfs({
      '/bundle/media/empty.jpg': '',
      '/bundle/media/orphan.jpg': '',
      '/bundle/modules/m00001/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para id="para" />
            <para id="para2" />
            <link target-id="para" />
            <link target-id="other" document="m99999" />
            <image src="../media/empty.jpg" />
          </content>
        </document>
      `,
      '/bundle/modules/m00002/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <para id="duplicate" />
            <para id="duplicate" />
          </content>
        </document>
      `,
      '/bundle/modules/m00003/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Another</md:title>
          </metadata>
          <content/>
        </document>
      `,
      '/bundle/modules/m00004/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title />
          </metadata>
          <content>Empty title</content>
        </document>
      `,
      '/bundle/modules/m00005/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
          </metadata>
          <content>No title</content>
        </document>
      `,
      '/bundle/collections/normal.collection.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>normal</md:title>
            <md:slug>normal</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="m00001" />
          </col:content>
        </col:collection>
      `,
      '/bundle/collections/normal-with-subcollection.collection.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>normal-with-subcollection</md:title>
            <md:slug>normal-with-subcollection</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="m00001" />
            <col:subcollection>
              <md:title>subcollection</md:title>
              <col:content>
                <col:module document="m00001" />
              </col:content>
            </col:subcollection>
          </col:content>
        </col:collection>
      `,
      '/bundle/collections/duplicate-module.collection.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>duplicate-module</md:title>
            <md:slug>duplicate-module</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="m00001" />
            <col:module document="m00001" />
          </col:content>
        </col:collection>
      `,
      '/bundle/collections/bad-document-link.collection.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>bad-document-link</md:title>
            <md:slug>bad-document-link</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="m99999" />
            <col:module document="m99999" />
          </col:content>
        </col:collection>
      `
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('can be created from a bundle directory', async () => {
    const bundle = await BookBundle.from('/bundle')
    assert.deepStrictEqual(bundle.images().sort(), ['empty.jpg', 'orphan.jpg'])
    assert.deepStrictEqual(bundle.modules().sort(), ['m00001', 'm00002', 'm00003', 'm00004', 'm00005'])
    assert.deepStrictEqual(bundle.collections().sort(), [
      'bad-document-link.collection.xml',
      'duplicate-module.collection.xml',
      'normal-with-subcollection.collection.xml',
      'normal.collection.xml'
    ])
  })
  it('provides basic asset existence information', async () => {
    const bundle = await BookBundle.from('/bundle')
    assert(bundle.moduleExists('m00001'))
    assert(bundle.imageExists('empty.jpg'))
    assert(bundle.collectionExists('normal.collection.xml'))
  })
  it('provides basic element id information within modules', async () => {
    const bundle = await BookBundle.from('/bundle')
    assert(await bundle.isIdInModule('para', 'm00001'))
    assert(!(await bundle.isIdInModule('nope', 'm00001')))
    assert(await bundle.isIdUniqueInModule('para', 'm00001'))
    assert(await bundle.isIdInModule('duplicate', 'm00002'))
    assert(!(await bundle.isIdUniqueInModule('duplicate', 'm00002')))
    assert(!(await bundle.isIdInModule('does-not-exist', 'does-not-exist')))
    assert(!(await bundle.isIdUniqueInModule('does-not-exist', 'does-not-exist')))
    assert(!(await bundle.isIdUniqueInModule('does-not-exist', 'm00001')))
  })
  it('tracks and caches used images per module', async () => {
    const bundle = await BookBundle.from('/bundle')
    const images = expect(await bundle.moduleImages('m00001'))
    assert.deepStrictEqual(Array.from(images.inner), ['empty.jpg'])
    const cached = expect(await bundle.moduleImages('m00001'))
    assert(cacheEquals(images, cached))
    assert.strictEqual(await bundle.moduleImages('does-not-exist'), null)
  })
  it('tracks and caches declared ids per module', async () => {
    const bundle = await BookBundle.from('/bundle')
    const ids = expect(await bundle.moduleIds('m00001'))
    assert.deepStrictEqual(Array.from(ids.inner).sort(), ['para', 'para2'])
    const cached = expect(await bundle.moduleIds('m00001'))
    assert(cacheEquals(ids, cached))
    assert.strictEqual(await bundle.moduleIds('does-not-exist'), null)
  })
  it('removes duplicates from tracked ids per module', async () => {
    const bundle = await BookBundle.from('/bundle')
    const ids = expect(await bundle.moduleIds('m00002'))
    assert.deepStrictEqual(Array.from(ids.inner), ['duplicate'])
  })
  it('tracks and caches declared links per module', async () => {
    const bundle = await BookBundle.from('/bundle')
    const links = expect(await bundle.moduleLinks('m00001'))
    const expected = [
      {
        moduleid: 'm00001',
        targetid: 'para'
      }, {
        moduleid: 'm99999',
        targetid: 'other'
      }
    ]
    assert.deepStrictEqual(links.inner.sort((a, b) => a.moduleid.localeCompare(b.moduleid)), expected)
    const cached = expect(await bundle.moduleLinks('m00001'))
    assert(cacheEquals(links, cached))
    assert.strictEqual(await bundle.moduleLinks('does-not-exist'), null)
  })
  it('tracks and caches titles per module', async () => {
    const bundle = await BookBundle.from('/bundle')
    const title = expect(await bundle.moduleTitle('m00001'))
    const expected: ModuleTitle = { title: 'Introduction', moduleid: 'm00001' }
    assert.deepStrictEqual(title.inner, expected)
    const cached = expect(await bundle.moduleTitle('m00001'))
    assert(cacheEquals(title, cached))
    assert.strictEqual(await bundle.moduleTitle('does-not-exist'), null)
  })
  it('Allows existant but empty module titles', async () => {
    const bundle = await BookBundle.from('/bundle')
    const title = expect(await bundle.moduleTitle('m00004'))
    const expected: ModuleTitle = { title: '', moduleid: 'm00004' }
    assert.deepStrictEqual(title.inner, expected)
    const cached = expect(await bundle.moduleTitle('m00004'))
    assert(cacheEquals(title, cached))
  })
  it('reports module as unnamed if no title exists', async () => {
    const bundle = await BookBundle.from('/bundle')
    const title = expect(await bundle.moduleTitle('m00005'))
    const expected: ModuleTitle = { title: 'Unnamed Module', moduleid: 'm00005' }
    assert.deepStrictEqual(title.inner, expected)
    const cached = expect(await bundle.moduleTitle('m00005'))
    assert(cacheEquals(title, cached))
  })
  it('tracks and caches orphaned modules', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphaned = await bundle.orphanedModules()
    assert.deepStrictEqual(Array.from(orphaned.inner).sort(), ['m00002', 'm00003', 'm00004', 'm00005'])
    assert(cacheEquals(orphaned, await bundle.orphanedModules()))
  })
  it('tracks and caches orphaned images', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphaned = await bundle.orphanedImages()
    assert.deepStrictEqual(Array.from(orphaned.inner).sort(), ['orphan.jpg'])
    assert(cacheEquals(orphaned, await bundle.orphanedImages()))
  })
  it('tracks and caches table of contents trees', async () => {
    const bundle = await BookBundle.from('/bundle')
    const tree = expect(await bundle.collectionTree('normal.collection.xml'))
    const expected: TocTreeCollection = {
      type: 'collection',
      title: 'normal',
      slug: 'normal',
      children: [
        {
          type: 'module',
          title: 'Introduction',
          moduleid: 'm00001',
          subtitle: 'm00001'
        }
      ]
    }
    assert.deepStrictEqual(tree.inner, expected)
    assert(cacheEquals(tree, expect(await bundle.collectionTree('normal.collection.xml'))))
    assert.strictEqual(await bundle.collectionTree('does-not-exist'), null)
  })
  it('tracks and caches table of contents trees containing subcollections', async () => {
    const bundle = await BookBundle.from('/bundle')
    const tree = expect(await bundle.collectionTree('normal-with-subcollection.collection.xml'))
    const expected: TocTreeCollection = {
      type: 'collection',
      title: 'normal-with-subcollection',
      slug: 'normal-with-subcollection',
      children: [{
        type: 'module',
        title: 'Introduction',
        moduleid: 'm00001',
        subtitle: 'm00001'
      }, {
        type: 'subcollection',
        title: 'subcollection',
        children: [{
          type: 'module',
          title: 'Introduction',
          moduleid: 'm00001',
          subtitle: 'm00001'
        }]
      }]
    }
    assert.deepStrictEqual(tree.inner, expected)
    assert(cacheEquals(tree, expect(await bundle.collectionTree('normal-with-subcollection.collection.xml'))))
  })
  it('can provide modules directly as toc tree objects', async () => {
    const bundle = await BookBundle.from('/bundle')
    const module = await bundle.moduleAsTreeObject('m00001')
    const expected = {
      type: 'module',
      title: 'Introduction',
      moduleid: 'm00001',
      subtitle: 'm00001'
    }
    assert.deepStrictEqual(module, expected)
  })
  it('busts caches when a module is created', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedModules = await bundle.orphanedModules()
    bundle.processChange({ type: FileChangeType.Created, uri: '/bundle/modules/m00000/index.cnxml' })
    const orphanedModulesAgain = await bundle.orphanedModules()
    assert(!cacheEquals(orphanedModules, orphanedModulesAgain))
  })
  it('busts caches when a module is deleted', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedModules = await bundle.orphanedModules()
    bundle.processChange({ type: FileChangeType.Deleted, uri: '/bundle/modules/m00000/index.cnxml' })
    const orphanedModulesAgain = await bundle.orphanedModules()
    assert(!cacheEquals(orphanedModules, orphanedModulesAgain))
  })
  it('busts caches when a module is changed', async () => {
    const bundle = await BookBundle.from('/bundle')
    const tree = expect(await bundle.collectionTree('normal.collection.xml'))
    const orphanedImages = await bundle.orphanedImages()
    const moduleTitle = expect(await bundle.moduleTitle('m00002'))

    bundle.processChange({ type: FileChangeType.Changed, uri: '/bundle/modules/m00002/index.cnxml' })

    const treeAgainNotContains = expect(await bundle.collectionTree('normal.collection.xml'))
    const moduleTitleAgain = expect(await bundle.moduleTitle('m00002'))
    const orphanedImagesAgain = await bundle.orphanedImages()

    assert(!cacheEquals(moduleTitle, moduleTitleAgain))
    assert(!cacheEquals(orphanedImages, orphanedImagesAgain))
    assert(cacheEquals(tree, treeAgainNotContains))

    bundle.processChange({ type: FileChangeType.Changed, uri: '/bundle/modules/m00001/index.cnxml' })
    const treeAgainContains = expect(await bundle.collectionTree('normal.collection.xml'))
    assert(!cacheEquals(tree, treeAgainContains))
  })
  it('busts caches when an image is created', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedImages = await bundle.orphanedImages()
    bundle.processChange({ type: FileChangeType.Created, uri: '/bundle/media/test.png' })
    assert(!cacheEquals(orphanedImages, await bundle.orphanedImages()))
  })
  it('busts caches when an image is deleted', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedImages = await bundle.orphanedImages()
    bundle.processChange({ type: FileChangeType.Deleted, uri: '/bundle/media/test.png' })
    assert(!cacheEquals(orphanedImages, await bundle.orphanedImages()))
  })
  it('busts caches when a collection is created', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedModules = await bundle.orphanedModules()
    bundle.processChange({ type: FileChangeType.Created, uri: '/bundle/collections/normal.collection.xml' })
    const orphanedModulesAgain = await bundle.orphanedModules()
    assert(!cacheEquals(orphanedModules, orphanedModulesAgain))
  })
  it('busts caches when a collection is changed', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedModules = await bundle.orphanedModules()
    bundle.processChange({ type: FileChangeType.Changed, uri: '/bundle/collections/normal.collection.xml' })
    const orphanedModulesAgain = await bundle.orphanedModules()
    assert(!cacheEquals(orphanedModules, orphanedModulesAgain))
  })
  it('busts caches when a collection is deleted', async () => {
    const bundle = await BookBundle.from('/bundle')
    const orphanedModules = await bundle.orphanedModules()
    bundle.processChange({ type: FileChangeType.Deleted, uri: '/bundle/collections/normal.collection.xml' })
    const orphanedModulesAgain = await bundle.orphanedModules()
    assert(!cacheEquals(orphanedModules, orphanedModulesAgain))
  })
})
describe('BookBundle caching', () => {
  describe('cachify', () => {
    it('will provide cacheKey and inner', () => {
      const cachified = cachify({})
      assert.strictEqual(typeof cachified.cacheKey, 'string')
      assert.deepStrictEqual(cachified.inner, {})
    })
    it('will change its key on recachify', () => {
      const cachified = cachify({})
      const recachified = recachify(cachified)
      assert.strictEqual(cachified.inner, recachified.inner)
      assert(!cacheEquals(cachified, recachified))
    })
  })
  describe('cache equality', () => {
    it('checks for equality only on the cache key', () => {
      const cachified = cachify({ prop: 'apples' })
      const cloneCache = { cacheKey: cachified.cacheKey, inner: { prop: 'oranges' } }
      assert(cacheEquals(cachified, cloneCache))
    })
    it('can check for equality for lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, b, c]
      const clone = [a, b, c]
      assert(cacheListsEqual(arr, clone))
    })
    it('can check for equality for lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const arr = [a]
      const other = [b]
      assert(!cacheListsEqual(arr, other))
    })
    it('determines lists of varying length are unequal', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, b, c]
      const other = [a, b]
      assert(!cacheListsEqual(arr, other))
    })
    it('can check for equality for arg lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, [b, c]]
      const clone = [a, [b, c]]
      assert(cacheArgsEqual(arr, clone))
    })
    it('can check for equality for arg lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, [b, c]]
      const other = [a, b]
      assert(!cacheArgsEqual(arr, other))
    })
    it('can check for equality for arg lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, [b, c]]
      const other = [b, [b, c]]
      assert(!cacheArgsEqual(arr, other))
    })
    it('can check for equality for arg lists of cached items', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, [b, c]]
      const other = [a, [c, b]]
      assert(!cacheArgsEqual(arr, other))
    })
    it('determines arg lists of varying length are unequal', () => {
      const a = cachify({ item: 'a' })
      const b = cachify({ item: 'b' })
      const c = cachify({ item: 'c' })
      const arr = [a, [b, c]]
      const other = [a]
      assert(!cacheArgsEqual(arr, other))
    })
  })
  describe('cacheSort', () => {
    it('sorts cached items in cacheKey order to ensure memoization works', () => {
      const resetCacheKey = (): void => {}
      const a = { cacheKey: 'a', resetCacheKey }
      const b = { cacheKey: 'b', resetCacheKey }
      const c = { cacheKey: 'c', resetCacheKey }
      assert.deepStrictEqual(cacheSort([b, c, a]), [a, b, c])
    })
  })
})
