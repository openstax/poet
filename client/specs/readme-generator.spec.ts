import Sinon from 'sinon'
import expect from 'expect'
import vscode from 'vscode'

import { getLicense, writeReadmeForWorkspace } from '../src/readme-generator'
import * as utils from '../src/utils'

function makeLicenseElement(url: string | undefined, textContent: string | undefined): Element {
  return {
    getAttribute(_: string): string | undefined {
      return url
    },
    textContent: textContent
  } as any as Element
}

describe('getLicense', () => {
  it('returns a License object with expected properties', () => {
    const licenseElement = makeLicenseElement(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    const license = getLicense(licenseElement)

    expect(license).toEqual({
      url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      type: 'Creative Commons Attribution-NonCommercial-ShareAlike',
      version: '4.0',
      text: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    })
  })

  it('throws an error if the license text is missing', () => {
    const licenseElement = makeLicenseElement(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      ''
    )

    expect(() => getLicense(licenseElement)).toThrow('Expected license text')
  })

  it('throws an error if the license is localized and text content is undefined', () => {
    const licenseElement = makeLicenseElement(
      'https://creativecommons.org/licenses/by-nc/4.0/deed.en',
      undefined
    )

    expect(() => getLicense(licenseElement)).toThrow('Expected license text')
  })

  it('throws an error if the license URL is missing', () => {
    const licenseElement = makeLicenseElement(
      undefined,
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    expect(() => getLicense(licenseElement)).toThrow('No license url')
  })

  it('throws an error if the license URL is empty', () => {
    const licenseElement = makeLicenseElement(
      '',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    expect(() => getLicense(licenseElement)).toThrow('Empty license url')
  })

  it('throws an error if the license type contains an unrecognized attribute', () => {
    const licenseElement = makeLicenseElement(
      'https://creativecommons.org/licenses/by-nderp/4.0/deed.en',
      'Creative Commons Attribution-NoDerivatives 4.0 International License'
    )

    expect(() => getLicense(licenseElement)).toThrow('Unrecognized CC license attribute')
  })
})

describe('write readme', () => {
  const sinon = Sinon.createSandbox()
  const encoder = new TextEncoder()
  let getRootPathUri: Sinon.SinonStub<[], vscode.Uri | null>
  beforeEach(() => {
    getRootPathUri = sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file('.'))
  })
  afterEach(() => sinon.restore())

  const mkMockRead = (fakeFiles: Record<string, Uint8Array>) => {
    return async (uri: vscode.Uri) => {
      const fsPath = uri.fsPath
      const content = fakeFiles[fsPath]
      if (content == null) {
        throw new Error(`Got unexpected path in readFile stub ${fsPath}`)
      }
      return content
    }
  }
  const title1 = 'Stuff and things'
  const title2 = 'Stuff and other things'
  const title3 = 'Other stuff and other things'
  const slug1 = 'stuff-things'
  const slug2 = 'stuff-other-things'
  const slug3 = 'other-stuff-other-things'

  const mkCollection = (slug: string, title: string) => {
    return encoder.encode(`\
      <col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
        <col:metadata>
          <md:title>${title}</md:title>
          <md:slug>${slug}</md:slug>
          <md:language>en</md:language>
          <md:license url="http://creativecommons.org/licenses/by/4.0/"/>
        </col:metadata>
      </col:collection>
    `)
  }

  const mkMetaInf = (slugs: string[]): Uint8Array => {
    return encoder.encode(`\
      <container xmlns="https://openstax.org/namespaces/book-container" version="1">
        ${slugs.map(slug =>
          `<book slug="${slug}" style="dummy" href="../collections/${slug}.collection.xml"/>`
        ).join('\n')}
      </container>
    `)
  }

  const metaInfOneBook = mkMetaInf([slug1])
  const metaInfTwoBook = mkMetaInf([slug1, slug2])
  const metaInfThreeBook = mkMetaInf([slug1, slug2, slug3])

  const collectionS1 = mkCollection(slug1, title1)
  const collectionS2 = mkCollection(slug2, title2)
  const collectionS3 = mkCollection(slug3, title3)

  it('writes the readme for a single book', async () => {
    let output = ''
    let outputPath = ''
    const read = sinon.stub(vscode.workspace.fs, 'readFile').callsFake(mkMockRead({
      [`/collections/${slug1}.collection.xml`]: collectionS1,
      '/META-INF/books.xml': metaInfOneBook
    }))
    const write = sinon.stub(vscode.workspace.fs, 'writeFile').callsFake(async (uri: vscode.Uri, content: Uint8Array) => {
      outputPath = uri.fsPath
      output = (new TextDecoder().decode(content))
    })

    await writeReadmeForWorkspace()

    expect(getRootPathUri.callCount).toBe(1)
    expect(read.callCount).toBe(2)
    expect(write.callCount).toBe(1)
    expect(outputPath).toContain('README')
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(14)
    expect(outputLines[0].startsWith(`# ${title1}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${title1}_`)).toBe(true)
    expect(outputLines[6]).toContain(`The book can be viewed [online](https://openstax.org/details/books/${slug1})`)
  })

  it('writes the readme for a bundle of two', async () => {
    let output = ''
    let outputPath = ''
    const read = sinon.stub(vscode.workspace.fs, 'readFile').callsFake(mkMockRead({
      [`/collections/${slug1}.collection.xml`]: collectionS1,
      [`/collections/${slug2}.collection.xml`]: collectionS2,
      '/META-INF/books.xml': metaInfTwoBook
    }))
    const write = sinon.stub(vscode.workspace.fs, 'writeFile').callsFake(async (uri: vscode.Uri, content: Uint8Array) => {
      outputPath = uri.fsPath
      output = (new TextDecoder().decode(content))
    })

    await writeReadmeForWorkspace()

    expect(getRootPathUri.callCount).toBe(1)
    expect(read.callCount).toBe(3)
    expect(write.callCount).toBe(1)
    expect(outputPath).toContain('README')
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(16)
    expect(outputLines[0].startsWith(`# ${title1 + ' and ' + title2}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${title1 + ' and ' + title2}_`)).toBe(true)
    const toTest = [
      [slug1, title1],
      [slug2, title2]
    ]
    toTest.forEach(([slug, title], idx: number) => {
      expect(outputLines[7 + idx]).toContain(`- _${title}_ [online](https://openstax.org/details/books/${slug})`)
    })
  })

  it('writes the readme for a bundle of three', async () => {
    let output = ''
    let outputPath = ''
    const read = sinon.stub(vscode.workspace.fs, 'readFile').callsFake(mkMockRead({
      [`/collections/${slug1}.collection.xml`]: collectionS1,
      [`/collections/${slug2}.collection.xml`]: collectionS2,
      [`/collections/${slug3}.collection.xml`]: collectionS3,
      '/META-INF/books.xml': metaInfThreeBook
    }))
    const write = sinon.stub(vscode.workspace.fs, 'writeFile').callsFake(async (uri: vscode.Uri, content: Uint8Array) => {
      outputPath = uri.fsPath
      output = (new TextDecoder().decode(content))
    })

    await writeReadmeForWorkspace()

    expect(getRootPathUri.callCount).toBe(1)
    expect(read.callCount).toBe(4)
    expect(write.callCount).toBe(1)
    expect(outputPath).toContain('README')
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(17)
    expect(outputLines[0].startsWith(`# ${title1}, ${title2}, and ${title3}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${title1}, ${title2}, and ${title3}_`)).toBe(true)
    const toTest = [
      [slug1, title1],
      [slug2, title2],
      [slug3, title3]
    ]
    toTest.forEach(([slug, title], idx: number) => {
      expect(outputLines[7 + idx]).toContain(`- _${title}_ [online](https://openstax.org/details/books/${slug})`)
    })
  })

  it('fails for bundles that contain various licenses', async () => {
    const moddedColS1 = new TextEncoder().encode(
      new TextDecoder().decode(collectionS1)
        .replace(
          'http://creativecommons.org/licenses/by/4.0',
          'http://creativecommons.org/licenses/by-nd/4.0'
        )
    )

    sinon.stub(vscode.workspace.fs, 'readFile').callsFake(mkMockRead({
      [`/collections/${slug1}.collection.xml`]: moddedColS1,
      [`/collections/${slug2}.collection.xml`]: collectionS2,
      '/META-INF/books.xml': metaInfTwoBook
    }))

    let err: Error | undefined
    try {
      await writeReadmeForWorkspace()
    } catch (e) {
      err = e as Error
    }

    expect(err).toBeDefined()
    err = err as Error
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    expect(err.toString()).toBe('Error: Licenses differ between collections')
  })
})
