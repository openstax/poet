import {
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
import { BookBundle, ModuleTitle } from '../book-bundle'
import { cacheEquals, cachify, cacheSort, cacheListsEqual, cacheArgsEqual, recachify } from '../cachify'
import { TocTreeCollection } from '../../../common/src/toc-tree'
import { BundleValidationQueue, BundleValidationRequest, DiagnosticCode, validateCollection, validateCollectionModules, validateModule, validateModuleImagePaths, validateModuleLinks } from '../bundle-validation'
import { DOMParser } from 'xmldom'

const DIAGNOSTIC_SOURCE = 'cnxml language server'

function expect<T>(value: T | null | undefined): T {
  return expectOrig(value, 'test_assertion')
}

describe('general bundle validation', function () {
  before(function () {
    mockfs({
      '/bundle/collections': {},
      '/bundle/modules': {},
      '/bundle/media': {}
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('returns null when a bundle item does not exist', async () => {
    const bundle = await BookBundle.from('/bundle')
    assert.strictEqual(await validateCollection(bundle, 'no-exist'), null)
    assert.strictEqual(await validateCollectionModules(bundle, 'no-exist'), null)
    assert.strictEqual(await validateModule(bundle, 'no-exist'), null)
    assert.strictEqual(await validateModuleLinks(bundle, 'no-exist'), null)
    assert.strictEqual(await validateModuleImagePaths(bundle, 'no-exist'), null)
  })
})

describe('validateCollectionModules', function () {
  before(function () {
    mockfs({
      '/bundle/collections/valid.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>valid</md:title>
            <md:slug>valid</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="module" />
          </col:content>
        </col:collection>
      `,
      '/bundle/collections/invalid.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>invalid</md:title>
            <md:slug>invalid</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="no-exist" />
          </col:content>
        </col:collection>
      `,
      '/bundle/modules/module/index.cnxml': '',
      '/bundle/media': {}
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return no diagnostics when collection is valid', async () => {
    const bundle = await BookBundle.from('/bundle')
    const diagnostics = expect(await validateCollectionModules(bundle, 'valid.xml'))
    assert.strictEqual(diagnostics.length, 0)
  })
  it('should return diagnostics when collection is invalid', async () => {
    const bundle = await BookBundle.from('/bundle')
    const diagnostics = expect(await validateCollectionModules(bundle, 'invalid.xml'))
    assert.strictEqual(diagnostics.length, 1)
  })
})

describe('validateImagePaths', function () {
  before(function () {
    mockfs({
      '/bundle/collections': {},
      '/bundle/media/empty.jpg': '',
      '/bundle/stray.jpg': '',
      '/bundle/modules/no-content/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content />
        </document>
      `,
      '/bundle/modules/single-valid-image/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <image src="../../media/empty.jpg" />
          </content>
        </document>
      `,
      '/bundle/modules/invalid-image-no-exist/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <image src="../../media/no-exist.jpg" />
          </content>
        </document>
      `,
      '/bundle/modules/invalid-image-dupe/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <image src="../../media/dupe.jpg" />
            <image src="../../media/dupe.jpg" />
          </content>
        </document>
      `,
      '/bundle/modules/invalid-image-incomplete/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <image />
            <image src="" />
          </content>
        </document>
      `,
      '/bundle/modules/invalid-image-stray/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <image src="../../stray.jpg" />
          </content>
        </document>
      `
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return empty diagnostics when no images', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'no-content')
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics when all images are valid', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'single-valid-image')
    assert.deepStrictEqual(result, [])
  })
  it('should return diagnostics when images are invalid', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'invalid-image-no-exist')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 52)
      },
      message: 'Image file \'../../media/no-exist.jpg\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.ImagePath
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostics when images paths point outside the bundle', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'invalid-image-stray')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 43)
      },
      message: 'Image file \'../../stray.jpg\' exists, but not in the bundle media directory',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.ImagePath
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return correct diagnostics with duplicate invalid images', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'invalid-image-dupe')
    const expectedDiagnostic1: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 48)
      },
      message: 'Image file \'../../media/dupe.jpg\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.ImagePath
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(7, 12),
        end: Position.create(7, 48)
      },
      message: 'Image file \'../../media/dupe.jpg\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.ImagePath
    }
    assert.deepStrictEqual(result, [expectedDiagnostic1, expectedDiagnostic2])
  })
  it('should ignore incomplete image elements excluding empty src', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleImagePaths(bundle, 'invalid-image-incomplete')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(7, 12),
        end: Position.create(7, 28)
      },
      message: 'Image file \'\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.ImagePath
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
})

describe('validateLinks', function () {
  before(function () {
    mockfs({
      '/bundle/media': {},
      '/bundle/collections': {},
      '/bundle/modules/no-content/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content />
        </document>
      `,
      '/bundle/modules/link-empty-target/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link target-id="" />
          </content>
        </document>
      `,
      '/bundle/modules/link-no-target/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link document="link-no-target" />
          </content>
        </document>
      `,
      '/bundle/modules/link-empty-doc/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link document="" />
          </content>
        </document>
      `,
      '/bundle/modules/link-invalid-doc/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link document="no-exist" />
          </content>
        </document>
      `,
      '/bundle/modules/links-valid/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link target-id="para1" />
            <link document="links-valid" target-id="para1" />
            <para id="para1"></para>
          </content>
        </document>
      `,
      '/bundle/modules/links-invalid-target/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link target-id="no-exist" />
            <link document="links-invalid-target" target-id="no-exist" />
          </content>
        </document>
      `,
      '/bundle/modules/links-duplicate-target/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link target-id="para" />
            <link document="links-duplicate-target" target-id="para" />
            <para id="para" />
            <para id="para" />
          </content>
        </document>
      `
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('should return empty diagnostics when no links', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'no-content')
    assert.deepStrictEqual(result, [])
  })
  it('should return diagnostics when target-id is empty', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'link-empty-target')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 33)
      },
      message: 'Target ID \'\' in document \'link-empty-target\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should return diagnostics when document is empty', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'link-empty-doc')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 32)
      },
      message: 'Target document \'\' for link cannot be found in the bundle',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
  it('should allow links pointing directly to existing documents', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'link-no-target')
    assert.deepStrictEqual(result, [])
  })
  it('should return empty diagnostics when all links are valid', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'links-valid')
    assert.deepStrictEqual(result, [])
  })
  it('should return diagnostics when target-id does not exist', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'links-invalid-target')
    const expectedDiagnostic1: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 41)
      },
      message: 'Target ID \'no-exist\' in document \'links-invalid-target\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(7, 12),
        end: Position.create(7, 73)
      },
      message: 'Target ID \'no-exist\' in document \'links-invalid-target\' does not exist',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    assert.deepStrictEqual(result, [expectedDiagnostic1, expectedDiagnostic2])
  })
  it('should return diagnostics target-id is a duplicate', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'links-duplicate-target')
    const expectedDiagnostic1: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 37)
      },
      message: 'Target ID \'para\' in document \'links-duplicate-target\' is not unique',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    const expectedDiagnostic2: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(7, 12),
        end: Position.create(7, 71)
      },
      message: 'Target ID \'para\' in document \'links-duplicate-target\' is not unique',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    assert.deepStrictEqual(result, [expectedDiagnostic1, expectedDiagnostic2])
  })
  it('should return diagnostic when target document does not exist', async () => {
    const bundle = await BookBundle.from('/bundle')
    const result = await validateModuleLinks(bundle, 'link-invalid-doc')
    const expectedDiagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(6, 12),
        end: Position.create(6, 40)
      },
      message: 'Target document \'no-exist\' for link cannot be found in the bundle',
      source: DIAGNOSTIC_SOURCE,
      code: DiagnosticCode.Link
    }
    assert.deepStrictEqual(result, [expectedDiagnostic])
  })
})

describe('ValidationQueue', function () {
  const noConnection: any = {}
  before(function () {
    mockfs({
      '/bundle/media': {},
      '/bundle/collections/valid.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>valid</md:title>
            <md:slug>valid</md:slug>
          </col:metadata>
          <col:content />
        </col:collection>
      `,
      '/bundle/collections/invalid.xml': `
        <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml">
          <col:metadata>
            <md:title>invalid</md:title>
            <md:slug>invalid</md:slug>
          </col:metadata>
          <col:content>
            <col:module document="no-exist" />
          </col:content>
        </col:collection>
      `,
      '/bundle/modules/valid/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content />
        </document>
      `,
      '/bundle/modules/invalid/index.cnxml': `
        <document xmlns="http://cnx.rice.edu/cnxml">
          <metadata xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Module</md:title>
          </metadata>
          <content>
            <link document="no-exist" />
          </content>
        </document>
      `
    })
  })
  after(function () {
    mockfs.restore()
  })
  it('will error when validation is requested for an uri that is not in the bundle', async () => {
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/no-exist/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    await assert.rejects((validationQueue as any).processQueue())
  })
  it('will log error when validation is requested for an uri that is not in the bundle', async () => {
    const clock = sinon.useFakeTimers()
    const bundle = await BookBundle.from('/bundle')
    const connection = {
      console: {
        error: sinon.stub()
      }
    }
    const validationQueue = new BundleValidationQueue(bundle, connection as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/no-exist/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    clock.next()
    await (validationQueue as any).timer
    assert.notStrictEqual(validationQueue.errorEncountered, undefined)
    assert(connection.console.error.calledOnce)
    clock.restore()
  }).timeout(5000)
  it('should queue all bundle items when a request is made', async () => {
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/valid/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    // The triggering uri is added twice (once in normal position, once prioritized before the rest of the bundle items)
    assert.strictEqual((validationQueue as any).queue.length, 5)
  })
  it('should drop old items when a request is made', async () => {
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest1: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/valid/index.cnxml'
    }
    const validationRequest2: BundleValidationRequest = {
      causeUri: 'file:///bundle/collections/valid.xml'
    }
    validationQueue.addRequest(validationRequest1)
    validationQueue.addRequest(validationRequest2)
    // The triggering uri is added twice (once in normal position, once prioritized before the rest of the bundle items)
    assert.strictEqual((validationQueue as any).queue.length, 5)
  })
  it('should self-trigger when adding requests', async () => {
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    const triggerStub = sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/valid/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    assert(triggerStub.calledOnce)
  })
  it('should process items upon triggering', async () => {
    const clock = sinon.useFakeTimers()
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    const processQueueSpy = sinon.spy(validationQueue as any, 'processQueue')
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/valid/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    // All of the requests should still be in the queue
    assert.strictEqual((validationQueue as any).queue.length, 5)
    // Advance the event loop and ensure the queue is consumed
    clock.next()
    await (validationQueue as any).timer
    assert.strictEqual((validationQueue as any).queue.length, 4)
    assert(processQueueSpy.calledOnce)
    clock.restore()
  })
  it('should not send diagnostics when processing valid document', async () => {
    const bundle = await BookBundle.from('/bundle')
    const connection = {
      sendDiagnostics: sinon.stub()
    }
    const validationQueue = new BundleValidationQueue(bundle, connection as any)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/collections/valid.xml'
    }
    validationQueue.addRequest(validationRequest)
    await (validationQueue as any).processQueue()
    assert(connection.sendDiagnostics.notCalled)
  })
  it('should not send diagnostics when processing valid document', async () => {
    const bundle = await BookBundle.from('/bundle')
    const connection = {
      sendDiagnostics: sinon.stub()
    }
    const validationQueue = new BundleValidationQueue(bundle, connection as any)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/valid/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    await (validationQueue as any).processQueue()
    assert(connection.sendDiagnostics.notCalled)
  })
  it('should send diagnostics when processing invalid document', async () => {
    const bundle = await BookBundle.from('/bundle')
    const connection = {
      sendDiagnostics: sinon.stub()
    }
    const validationQueue = new BundleValidationQueue(bundle, connection as any)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/collections/invalid.xml'
    }
    validationQueue.addRequest(validationRequest)
    await (validationQueue as any).processQueue()
    assert(connection.sendDiagnostics.calledOnce)
  })
  it('should send diagnostics when processing invalid document', async () => {
    const bundle = await BookBundle.from('/bundle')
    const connection = {
      sendDiagnostics: sinon.stub()
    }
    const validationQueue = new BundleValidationQueue(bundle, connection as any)
    sinon.stub(validationQueue, 'trigger' as any)
    const validationRequest: BundleValidationRequest = {
      causeUri: 'file:///bundle/modules/invalid/index.cnxml'
    }
    validationQueue.addRequest(validationRequest)
    await (validationQueue as any).processQueue()
    assert(connection.sendDiagnostics.calledOnce)
  })
  it('should do nothing when processing empty queue', async () => {
    const bundle = await BookBundle.from('/bundle')
    const validationQueue = new BundleValidationQueue(bundle, noConnection)
    const promise = (validationQueue as any).processQueue()
    await assert.doesNotReject(promise)
  })
})

describe('calculateElementPositions', function () {
  it('should return start and end positions using siblings when available', async () => {
    const xmlContent = `
      <document>
        <content>
          <image src="" />
        </content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
    const elements = xpath.select('//image', xmlData) as Element[]
    const imageElement = elements[0]
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
  it('should return start and end positions based on attributes when no siblings', async () => {
    const xmlContent = `
      <document>
        <content><image src="value" /></content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
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
  it('should return start and end positions based on tag when no siblings or attributes', async () => {
    const xmlContent = `
      <document>
        <content><image /></content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
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
                <col:module document="m00003" />
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
    const actual = links.inner.sort((a, b) => a.moduleid.localeCompare(b.moduleid))
    expected.forEach((value, i) => {
      assert.strictEqual(actual[i].moduleid, value.moduleid)
      assert.strictEqual(actual[i].targetid, value.targetid)
    })
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
    assert.deepStrictEqual(Array.from(orphaned.inner).sort(), ['m00002', 'm00004', 'm00005'])
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
          title: 'Another',
          moduleid: 'm00003',
          subtitle: 'm00003'
        }]
      }]
    }
    assert.deepStrictEqual(tree.inner, expected)
    const cacheExpected = expect(await bundle.collectionTree('normal-with-subcollection.collection.xml'))
    assert(cacheEquals(tree, cacheExpected))
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
