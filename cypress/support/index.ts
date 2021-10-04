import '@cypress/code-coverage/support'
import * as snapshot from '@cypress/snapshot'
snapshot.register()

// Credit: User zquancai on GitHub
// Code from this comment: https://github.com/cypress-io/cypress/issues/1752#issuecomment-459625541
// Modified to match the needs of react-sortable-tree
class DndSimulatorDataTransfer {
  data = {}
  dropEffect = 'move'
  effectAllowed = 'all'
  files = []
  items: any[] = []
  types: string[] = []
  clearData(format?: string): void {
    if (format !== undefined) {
      delete this.data[format] // eslint-disable-line @typescript-eslint/no-dynamic-delete
      const index = this.types.indexOf(format)
      delete this.types[index] // eslint-disable-line @typescript-eslint/no-dynamic-delete
      delete this.data[index] // eslint-disable-line @typescript-eslint/no-dynamic-delete
    } else {
      this.data = {}
    }
  }

  setData(format: string, data: any): void {
    this.data[format] = data
    this.items.push(data)
    this.types.push(format)
  }

  getData(format: string): any {
    if (format in this.data) {
      return this.data[format]
    }
    return ''
  }

  setDragImage(img, xOffset, yOffset): void { }
}
const dndCommand = (subject: JQuery<HTMLElement>, targetSelector: string, options: { offsetX?: number, offsetY?: number } = {}): void => {
  const dataTransfer = new DndSimulatorDataTransfer()
  const opts = {
    offsetX: 10,
    offsetY: 10,
    ...options
  }

  cy.wrap(subject.get(0))
    .trigger('dragstart', {
      dataTransfer
    })
    .trigger('drag', {})
  cy.wait(100)

  // Drag to the old position of the target
  cy.get(targetSelector).then($el => {
    cy.wrap($el.get(0))
      .trigger('dragover', {
        dataTransfer
      })
  })
  cy.wait(100)

  // Drag to the offset, potentially providing a different drop location
  cy.get(targetSelector).then($el => {
    const {
      x,
      y
    }: { x: number, y: number } = $el.get(0).getBoundingClientRect()
    cy.wrap($el.get(0))
      .trigger('dragover', {
        dataTransfer,
        clientX: x + opts.offsetX,
        clientY: y + opts.offsetY
      })
  })
  cy.wait(100)

  cy.get(targetSelector).then($el => {
    cy.wrap($el.get(0))
      .trigger('drop', {
        dataTransfer
      })
      .trigger('dragend', {
        dataTransfer
      })
  })
}

Cypress.Commands.add('awaitInternalEvent', <T extends keyof GlobalEventHandlersEventMap>(event: T, func: () => void) => {
  return cy.wrap(new Promise(resolve => {
    cy.window().then(win => {
      win.addEventListener(event, resolve)
      func()
    })
  }))
})

Cypress.Commands.add('dnd', { prevSubject: 'element' }, dndCommand)

Cypress.Commands.add('dropFile', { prevSubject: 'element' }, (subject: Cypress.Chainable, fileName: string) => {
  cy.fixture(fileName, 'base64')
    .then(Cypress.Blob.base64StringToBlob)
    .then(blob => {
      const file = new File([blob], fileName)
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      cy.wrap(subject)
        .trigger('drop', { dataTransfer })
    })
})
