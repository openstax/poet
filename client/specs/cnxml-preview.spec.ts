import expect from 'expect'
import { DOMParser, XMLSerializer } from 'xmldom'
import { tagElementsWithLineNumbers } from '../src/panel-cnxml-preview'

describe('cnxml-preview', () => {
  it('tagElementsWithLineNumbers', () => {
    const xml = `
    <document>
        <div><span>Test</span><div/></div>
    </document>`
    const doc = new DOMParser().parseFromString(xml)
    tagElementsWithLineNumbers(doc)
    const out = new XMLSerializer().serializeToString(doc)
    expect(out).toMatchSnapshot()
  })
})
