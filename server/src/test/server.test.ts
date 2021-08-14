import assert from 'assert'
import * as xpath from 'xpath-ts'
import { Position } from 'vscode-languageserver'
import { DOMParser, XMLSerializer } from 'xmldom'
import { calculateElementPositions } from '../model/utils'
import { fixDocument, padLeft } from '../fix-document-ids'

describe('calculateElementPositions', function () {
  it('should return start and end positions using siblings when available', () => {
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
  it('should return start and end positions based on attributes when no siblings', () => {
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
  it('should return start and end positions based on tag when no siblings or attributes', () => {
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

describe('Element ID creation', () => {
  describe('fixDocument', () => {
    it('check if ids are created', () => {
      const simple = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para id="test">Test Introduction</para>
            <para>no id here</para>
          </content>
        </document>`
      const simpleFixed = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para id="test">Test Introduction</para>
            <para id="para-00001">no id here</para>
          </content>
        </document>`
      const doc = new DOMParser().parseFromString(simple)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      assert.strictEqual(out, simpleFixed)
    })
    it('check if ids are created in right order', () => {
      const paraPartialId = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <section>
              <para id="para-00001">Test Introduction</para>
              <para>no id here</para>
            </section>
            <section id="sect-00001">
              <para id="para-00002">oh we have id2 here</para>
              <para id="para-00003">oh we have id3 here</para>
              <para>no id here</para>
              <para>no id here</para>
            </section>
          </content>
        </document>`
      const doc = new DOMParser().parseFromString(paraPartialId)
      fixDocument(doc)
      const NS_CNXML = 'http://cnx.rice.edu/cnxml'
      const select = xpath.useNamespaces({ cnxml: NS_CNXML })
      const fixParaNodes = select('//cnxml:para', doc) as Element[]
      assert.strictEqual(fixParaNodes[0].getAttribute('id'), 'para-00001')
      assert.strictEqual(fixParaNodes[1].getAttribute('id'), 'para-00004')
      assert.strictEqual(fixParaNodes[2].getAttribute('id'), 'para-00002')
      assert.strictEqual(fixParaNodes[3].getAttribute('id'), 'para-00003')
      assert.strictEqual(fixParaNodes[4].getAttribute('id'), 'para-00005')
      assert.strictEqual(fixParaNodes[5].getAttribute('id'), 'para-00006')
      const fixSectionNodes = select('//cnxml:section', doc) as Element[]
      assert.strictEqual(fixSectionNodes[0].getAttribute('id'), 'sect-00002')
      assert.strictEqual(fixSectionNodes[1].getAttribute('id'), 'sect-00001')
    })
    it('check if ids are generated with right (short) prefix', () => {
      const xml = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para>no id here</para>
            <equation/>
            <list/>
            <section/>
            <problem/>
            <solution/>
            <exercise/>
            <example/>
            <figure/>
            <definition/>
            <para>
              <term>hello</term>
            </para>
            <table/>
            <quote/>
            <note/>
            <footnote/>
            <cite/>
          </content>
        </document>`
      const xmlFixed = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para id="para-00001">no id here</para>
            <equation id="eq-00001"/>
            <list id="list-00001"/>
            <section id="sect-00001"/>
            <problem id="prob-00001"/>
            <solution id="sol-00001"/>
            <exercise id="exer-00001"/>
            <example id="exam-00001"/>
            <figure id="fig-00001"/>
            <definition id="def-00001"/>
            <para id="para-00002">
              <term id="term-00001">hello</term>
            </para>
            <table id="table-00001"/>
            <quote id="quote-00001"/>
            <note id="note-00001"/>
            <footnote id="foot-00001"/>
            <cite id="cite-00001"/>
          </content>
        </document>`
      const doc = new DOMParser().parseFromString(xml)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      assert.strictEqual(out, xmlFixed)
    })
    it('check if term in defintion does not get an id', () => {
      const xml = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para>
              <term id="term-00001">hello</term>
            </para>
            <definition>
              <term>I should not get an id</term>
            </definition>
            <para>
              <term>need id</term>
            </para>
          </content>
        </document>`
      const xmlFixed = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
          <title>Introduction</title>
          <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
            <md:title>Introduction</md:title>
          </metadata>
          <content>
            <para id="para-00001">
              <term id="term-00001">hello</term>
            </para>
            <definition id="def-00001">
              <term>I should not get an id</term>
            </definition>
            <para id="para-00002">
              <term id="term-00002">need id</term>
            </para>
          </content>
        </document>`
      const doc = new DOMParser().parseFromString(xml)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      assert.strictEqual(out, xmlFixed)
    })
    it('check high id number generation works right', () => {
      assert.strictEqual(padLeft('1', '0', 5), '00001')
      assert.strictEqual(padLeft('1000', '0', 5), '01000')
      assert.strictEqual(padLeft('10000', '0', 5), '10000')
      assert.strictEqual(padLeft('100000', '0', 5), '100000')
      assert.strictEqual(padLeft('34262934876', '0', 5), '34262934876')
      assert.strictEqual(padLeft('99999', '0', 5), '99999')
      assert.strictEqual(padLeft('9999', '0', 5), '09999')
    })
  })
})
