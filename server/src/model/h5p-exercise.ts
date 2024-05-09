import { Fileish, type ValidationCheck } from './fileish'

export class H5PExercise extends Fileish {
  public static readonly PLACEHOLDER = '{INTERACTIVES_ROOT}'

  protected getValidationChecks(): ValidationCheck[] {
    return []
  }
}
