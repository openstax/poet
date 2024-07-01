import { expect } from '@jest/globals'
import assert from 'assert'
import * as xpath from 'xpath-ts'
import { DOMParser, XMLSerializer } from 'xmldom'
import { fixDocument, idFixer, padLeft } from './fix-document-ids'
import mockfs from 'mock-fs'
import { bundleMaker, pageMaker } from './model/spec-helpers.spec'

describe('Element ID creation', () => {
  describe('fixDocument', () => {
    it('check if ids are created', () => {
      const simple = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
            <title>Introduction</title>
            <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
              <md:uuid>00000000-0000-0000-0000-000000000000</md:uuid>
            </metadata>
            <content>
              <para id="test">Test Introduction</para>
              <para>no id here</para>
            </content>
          </document>`
      const doc = new DOMParser().parseFromString(simple)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      expect(out).toMatchSnapshot()
    })
    it('check if ids are created in right order', () => {
      const paraPartialId = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
            <title>Introduction</title>
            <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
              <md:uuid>00000000-0000-0000-0000-000000000000</md:uuid>
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
              <md:uuid>00000000-0000-0000-0000-000000000000</md:uuid>
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
      const doc = new DOMParser().parseFromString(xml)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      expect(out).toMatchSnapshot()
    })
    it('check if term in defintion does not get an id', () => {
      const xml = `<document id="new" cnxml-version="0.7" module-id="" xmlns="http://cnx.rice.edu/cnxml" class="introduction">
            <title>Introduction</title>
            <metadata mdml-version="0.5" xmlns:md="http://cnx.rice.edu/mdml">
              <md:uuid>00000000-0000-0000-0000-000000000000</md:uuid>
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
      const doc = new DOMParser().parseFromString(xml)
      fixDocument(doc)
      const out = new XMLSerializer().serializeToString(doc)
      expect(out).toMatchSnapshot()
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
  describe('fixModule', () => {
    beforeEach(() => {
      mockfs({
        'META-INF/books.xml': bundleMaker({}),
        'modules/m2468/index.cnxml': pageMaker({ extraCnxml: '<para>should get autogenerated id added</para>' })
      })
    })
    afterEach(() => { mockfs.restore() })
    it('fixes a page in-memory', () => {
      const input = pageMaker({ extraCnxml: '<para>should get autogenerated id added</para>' })
      const out = idFixer(input, 'somefilenamedoesnotmatter')
      expect(out).toEqual(expect.stringContaining('<para id="para-00001">'))
    })
  })
})
