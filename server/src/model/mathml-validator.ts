import I from 'immutable'
import * as Quarx from 'quarx'

import { Fileish, ValidationCheck, ValidationKind } from './fileish'
import { Opt, WithRange, select, calculateElementPositions, expectValue } from './utils'

export class MathValidationKind extends ValidationKind {
  static NEGATIVE_MSPACE_WIDTH = new MathValidationKind('mspace width cannot be negative')
  static EMPTY_MSPACE_WIDTH = new MathValidationKind('mspace width cannot be empty')
}

export class MMLValidator {
  private readonly _mspaceWidths = Quarx.observable.box<Opt<I.Set<WithRange<string>>>>(undefined)

  public parseXML(doc: Document): void {
    const mspaceWidths = select('//m:mspace/@width', doc) as Attr[]
    this._mspaceWidths.set(I.Set(mspaceWidths.map(attr => {
      const width = expectValue(attr.nodeValue, 'BUG: Attribute does not have a value')
      const mspaceNode = expectValue(attr.ownerElement, 'BUG: attributes always have a parent element')
      const range = calculateElementPositions(mspaceNode)
      return { range, v: width }
    })))
  }

  public getValidationChecks(file: Fileish): ValidationCheck[] {
    return [
      {
        message: MathValidationKind.NEGATIVE_MSPACE_WIDTH,
        nodesToLoad: I.Set(),
        fn: () => {
          return I.Set(
            expectValue(this._mspaceWidths.get(), `mspace not loaded [${file.absPath}]`)
              .filter(i => {
                const width = i.v.trim()
                return width.length !== 0 && width[0] === '-'
              }).map(i => i.range)
          )
        }
      },
      {
        message: MathValidationKind.EMPTY_MSPACE_WIDTH,
        nodesToLoad: I.Set(),
        fn: () => {
          return I.Set(
            expectValue(this._mspaceWidths.get(), `mspace not loaded [${file.absPath}]`)
              .filter(i => i.v.trim().length === 0)
              .map(i => i.range)
          )
        }
      }
    ]
  }
}
