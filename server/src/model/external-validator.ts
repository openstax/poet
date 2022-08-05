import { ValidationCheck } from './fileish'
import { PageNode } from './page'

export interface ExternalValidator {
  parseXML: (doc: Document) => void
  getValidationChecks: (page: PageNode) => ValidationCheck[]
}
