import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import {
  parseXMLString,
  validateImagePaths,
  validateLinks,
  IMAGEPATH_DIAGNOSTIC_SOURCE,
  LINK_DIAGNOSTIC_SOURCE,
  getCurrentModules
} from './../utils'

import assert from 'assert'
import mockfs from 'mock-fs'
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'

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
    const expected = [
      '/workspace/modules/m00001/index.cnxml',
      '/workspace/modules/m00002/index.cnxml'
    ]
    assert.deepStrictEqual(result, expected)
  })
  it('should return empty array if modules directory doesn\'t exist', async function () {
    const workspaceFolder = {
      index: 0,
      name: '',
      uri: 'file:///emptyworkspace'
    }
    const result = await getCurrentModules([workspaceFolder])
    assert.deepStrictEqual(result, [])
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
    const result = await validateLinks(xmlData, [])
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics when all links are valid', async function () {
    const inputContent = `
      <document xmlns="http://cnx.rice.edu/cnxml">
        <content>
          <link target-id="para1" />
          <link document="m00001" />
          <para id="para1"></para>
        </content>
      </document>
    `
    const inputDocument = TextDocument.create(
      'file:///modules/m12345/index.cnxml', '', 0, inputContent
    )
    const xmlData = await parseXMLString(inputDocument)
    assert(xmlData != null)
    const result = await validateLinks(xmlData, ['/modules/m00001/index.cnxml'])
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
    const result = await validateLinks(xmlData, [])
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
    const result = await validateLinks(xmlData, [])
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
    const result = await validateLinks(xmlData, [])
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
    const result = await validateLinks(xmlData, ['/modules/m00001/index.cnxml'])
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
    const result = await validateLinks(xmlData, ['/modules/m00001/index.cnxml'])
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
    const result = await validateLinks(xmlData, ['/modules/empty/index.cnxml'])
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
