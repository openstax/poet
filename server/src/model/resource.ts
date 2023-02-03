import I from 'immutable'
import { Fileish, ValidationKind } from './fileish'
import { NOWHERE, Range } from './utils'

// This can be an Image or an IFrame
export class ResourceNode extends Fileish {
  private checkDuplicateResources(): I.Set<Range> {
    const myLower = this.absPath.toLowerCase()
    for (const resource of this.bundle.allResources.all) {
      if (resource === this) {
        continue
      }
      const lower = resource.absPath.toLowerCase()
      if (lower === myLower) {
        return I.Set<Range>([NOWHERE])
      }
    }
    return I.Set()
  }

  protected getValidationChecks() {
    return [{
      message: ResourceValidationKind.DUPLICATE_RESOURCES,
      nodesToLoad: I.Set<Fileish>(),
      fn: () => this.checkDuplicateResources()
    }]
  }
}

export class ResourceValidationKind extends ValidationKind {
  static DUPLICATE_RESOURCES = new ResourceValidationKind('Another file has the same name with a different case.')
}
