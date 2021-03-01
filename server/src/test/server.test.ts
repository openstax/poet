import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import {
  parseXMLString,
  validateImagePaths,
  validateLinks,
  IMAGEPATH_DIAGNOSTIC_SOURCE,
  LINK_DIAGNOSTIC_SOURCE,
  getCurrentModules,
  ValidationQueue,
  ValidationRequest,
  ModuleInformation,
  calculateElementPositions
} from './../utils'

import assert from 'assert'
import mockfs from 'mock-fs'
import sinon from 'sinon'
import * as xpath from 'xpath-ts'
import {
  Diagnostic,
  DiagnosticSeverity,
  Position
} from 'vscode-languageserver'

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
      source: IMAGEPATH_DIAGNOSTIC_SOURCE
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image3Location),
        end: inputDocument.positionAt(image3Location + '<image src="../../media/image3.jpg" />'.length)
      },
      message: 'Image file ../../media/image3.jpg doesn\'t exist!',
      source: IMAGEPATH_DIAGNOSTIC_SOURCE
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
      source: IMAGEPATH_DIAGNOSTIC_SOURCE
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: inputDocument.positionAt(image2DupLocation),
        end: inputDocument.positionAt(image2DupLocation + '<image src="../../media/image2.jpg" />'.length)
      },
      message: 'Image file ../../media/image2.jpg doesn\'t exist!',
      source: IMAGEPATH_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
      source: LINK_DIAGNOSTIC_SOURCE
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
})
