/// <reference types="cypress" />
import path from 'path'

describe('My First Test', () => {
    it('Does not do much!', () => {
      cy.visit('./dist/cnxml-preview.html')
      expect(true).to.equal(true)
    })
  })