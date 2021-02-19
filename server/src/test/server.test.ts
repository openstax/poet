import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import {
  parseXMLString, validateImagePaths, IMAGEPATH_DIAGNOSTIC_SOURCE
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
