import path from 'path'
import I from 'immutable'
import { DOMParser } from 'xmldom'
import * as Quarx from 'quarx'
import { Bundleish, Opt, PathHelper, expectValue, Range, HasRange, NOWHERE } from './utils'

export class ModelError extends Error implements HasRange {
  constructor(public readonly node: Fileish, message: string, public readonly range: Range) {
    super(message)
    this.name = this.constructor.name
  }
}
export class ParseError extends ModelError { }
export class WrappedParseError<T extends Error> extends ParseError {
  constructor(node: Fileish, originalError: T) {
    super(node, originalError.message, NOWHERE)
  }
}

export interface ValidationCheck {
  message: string
  nodesToLoad: I.Set<Fileish>
  fn: (loadedNodes?: I.Set<Fileish>) => I.Set<Range>
}
export class ValidationResponse {
  constructor(public readonly errors: I.Set<ModelError>, public readonly nodesToLoad: I.Set<Fileish> = I.Set()) {}

  static continueOnlyIfLoaded(nodes: I.Set<Fileish>, next: (nodes: I.Set<Fileish>) => I.Set<ModelError>) {
    const unloaded = nodes.filter(n => !n.isLoaded)
    if (unloaded.size > 0) {
      return new ValidationResponse(I.Set(), unloaded)
    } else {
      return new ValidationResponse(next(nodes))
    }
  }
}

function toValidationErrors(node: Fileish, message: string, sources: I.Set<Range>) {
  return sources.map(s => new ModelError(node, message, s))
}

export abstract class Fileish {
  private readonly _isLoaded = Quarx.observable.box(false)
  private readonly _exists = Quarx.observable.box(false)
  private readonly _parseError = Quarx.observable.box<Opt<ParseError>>(undefined)
  protected parseXML: Opt<(doc: Document) => void> // Subclasses define this

  constructor(private _bundle: Opt<Bundleish>, protected _pathHelper: PathHelper<string>, public readonly absPath: string) { }

  static debug = (...args: any[]) => {} // console.debug
  protected abstract getValidationChecks(): ValidationCheck[]
  public get isLoaded() { return this._isLoaded.get() }
  public get workspacePath() { return path.relative(this.bundle.workspaceRootUri, this.absPath) }
  protected setBundle(bundle: Bundleish) { this._bundle = bundle /* avoid catch-22 */ }
  protected get bundle() { return expectValue(this._bundle, 'BUG: This object was not instantiated with a Bundle. The only case that should occur is when this is a Bundle object') }
  protected ensureLoaded<T>(field: Quarx.Box<Opt<T>>) {
    return expectValue(field.get(), `Object has not been loaded yet [${this.absPath}]`)
  }

  public get exists() { return this._exists.get() }
  // Update this Node, and collect all Parse errors
  public load(fileContent: Opt<string>): void {
    Fileish.debug(this.workspacePath, 'update() started')
    this._parseError.set(undefined)
    if (fileContent === undefined) {
      this._exists.set(false)
      this._isLoaded.set(true)
      return
    }
    if (this.parseXML !== undefined) {
      Fileish.debug(this.workspacePath, 'parsing XML')

      // Development version throws errors instead of turning them into messages
      const parseXML = this.parseXML
      const fn = () => {
        const doc = this.readXML(fileContent)
        if (this._parseError.get() !== undefined) return
        parseXML(doc)
        this._isLoaded.set(true)
        this._exists.set(true)
      }
      if (process.env.NODE_ENV !== 'production') {
        fn()
      } else {
        try {
          fn()
        } catch (e) {
          this._parseError.set(new WrappedParseError(this, e))
        }
      }
      Fileish.debug(this.workspacePath, 'parsing XML (done)')
    } else {
      this._exists.set(true)
      this._isLoaded.set(true)
    }
    Fileish.debug(this.workspacePath, 'update done')
  }

  private readXML(fileContent: string) {
    const locator = { lineNumber: 0, columnNumber: 0 }
    const cb = (msg: string) => {
      const pos = {
        line: locator.lineNumber - 1,
        character: locator.columnNumber - 1
      }
      this._parseError.set(new ParseError(this, msg, { start: pos, end: pos }))
    }
    const p = new DOMParser({
      locator,
      errorHandler: {
        warning: console.warn,
        error: cb,
        fatalError: cb
      }
    })
    const doc = p.parseFromString(fileContent)
    return doc
  }

  public get validationErrors(): ValidationResponse {
    const parseError = this._parseError.get()
    if (parseError !== undefined) {
      return new ValidationResponse(I.Set([parseError]))
    } else if (!this._isLoaded.get()) {
      return new ValidationResponse(I.Set(), I.Set([this]))
    } else if (!this._exists.get()) {
      return new ValidationResponse(I.Set(), I.Set())
    } else {
      const responses = this.getValidationChecks().map(c => ValidationResponse.continueOnlyIfLoaded(c.nodesToLoad, () => toValidationErrors(this, c.message, c.fn(c.nodesToLoad))))
      const nodesToLoad = I.Set(responses.map(r => r.nodesToLoad)).flatMap(x => x)
      const errors = I.Set(responses.map(r => r.errors)).flatMap(x => x)
      return new ValidationResponse(errors, nodesToLoad)
    }
  }
}
