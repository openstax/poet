declare namespace Cypress {
  interface Chainable {
    /**
     * Select an element to DnD. See ./support/ for details.
     */
    dnd: (selector: string, options?: {offsetX?: number, offsetY?: number}) => void
    dropFile: (fileName: string) => void
  }
}
