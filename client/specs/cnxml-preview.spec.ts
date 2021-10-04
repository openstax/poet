import expect from 'expect'
import { DOMParser, XMLSerializer } from 'xmldom'
import { rawTextHtml, tagElementsWithLineNumbers } from '../src/panel-cnxml-preview'

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

  it('raw text html content for webview use', () => {
    const content = 'test'
    expect(rawTextHtml(content)).toBe('<html><body>test</body></html>')
  })
  it('raw text html content for webview use disallows potential unsafe text', () => {
    const content = '<injected></injected>'
    expect(() => { rawTextHtml(content) }).toThrow()
  })
})
