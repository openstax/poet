declare namespace Cypress {
  interface Chainable {
    /**
     * Select an element to DnD. See ./support/ for details.
     */
    dnd: (targetSelector: string, options?: { offsetX?: number, offsetY?: number }) => void
    /**
     * Simulate dropping a file onto the previous element in the chain. The given filename must be in fixtures.
     */
    dropFile: (fileName: string) => void
    /**
     * Wait until a window event fired within the inner function is received and event listeners have begun processing.
     * Pretty much every browser triggers listeners in registration order, so this should also imply that all listeners
     * for the provided event have finished processing, regardless of what Cypress is running on.
     */
    awaitInternalEvent: <T extends keyof GlobalEventHandlersEventMap>(event: T, func: () => void) => Cypress.Chainable

    snapshot: (options?: string | { name?: string, json?: boolean }) => void
  }
}
