/// <reference types="cypress" />
import path from 'path'

describe('My First Test', () => {
    it('Does not do much!', () => {
      cy.visit('./dist/cnxml-preview.html', {
        onBeforeLoad: (contentWindow) => {
          contentWindow.acquireVsCodeApi = () => { return 'HOORAY I AM NOT UNDEFINED!' }
        }
      })

      expect(true).to.equal(true)
    })
  })