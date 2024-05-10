import I from 'immutable'
import { Fileish, ValidationKind } from './fileish'
import { NOWHERE, type Range } from './utils'

// This can be an Image or an IFrame
export class ResourceNode extends Fileish {
  protected getValidationChecks() {
    return [{
      message: ResourceValidationKind.DUPLICATE_RESOURCES,
      nodesToLoad: I.Set<Fileish>(),
      fn: () => this.bundle.isDuplicateFilePath(this.absPath)
        ? I.Set([NOWHERE])
        : I.Set<Range>()
    }]
  }
}

export class ResourceValidationKind extends ValidationKind {
  static DUPLICATE_RESOURCES = new ResourceValidationKind('Another file has the same name with a different case.')
}
