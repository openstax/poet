import { Fileish } from './fileish'

// This can be an Image or an IFrame
export class ResourceNode extends Fileish {
  /* istanbul ignore next */
  protected getValidationChecks() { return [] }
}
