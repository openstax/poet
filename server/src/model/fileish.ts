import path from 'path'
import I from 'immutable'
import { DOMParser } from 'xmldom'
import { Bundleish, Opt, PathHelper, NOWHERE_END, NOWHERE_START, Position, Source, PathType, expect } from './utils'

const LOAD_ERROR = 'Object has not been loaded yet'

export class ModelError extends Error {
  constructor(public readonly node: Fileish, message: string, public readonly startPos: Position, public readonly endPos: Position) {
    super(message)
    this.name = this.constructor.name
  }
}
export class ParseError extends ModelError { }
export class WrappedParseError<T extends Error> extends ParseError {
  constructor(node: Fileish, originalError: T) {
    super(node, originalError.message, NOWHERE_START, NOWHERE_END)
  }
}

export interface ValidationCheck {
  message: string
  nodesToLoad: I.Set<Fileish>
  fn: (loadedNodes?: I.Set<Fileish>) => I.Set<Source>
}
export class ValidationResponse {
  constructor(public readonly errors: I.Set<ModelError>, public readonly nodesToLoad: I.Set<Fileish> = I.Set()) {}

  static continueOnlyIfLoaded(nodes: I.Set<Fileish>, next: (nodes: I.Set<Fileish>) => I.Set<ModelError>) {
    const unloaded = nodes.filter(n => !n.isLoaded())
    if (unloaded.size > 0) {
      return new ValidationResponse(I.Set(), unloaded)
    } else {
      return new ValidationResponse(next(nodes))
    }
  }
}

function toValidationErrors(node: Fileish, message: string, sources: I.Set<Source>) {
  return sources.map(s => new ModelError(node, message, s.startPos, s.endPos))
}

export abstract class Fileish {
  private _isLoaded = false
  private _exists = false
  private _parseError: Opt<ParseError>
  protected parseXML: Opt<(doc: Document) => void> // Subclasses define this
  protected childrenToLoad: Opt<() => I.Set<Fileish>> // Subclasses define this

  constructor(private _bundle: Opt<Bundleish>, protected _pathHelper: PathHelper<string>, public readonly absPath: string) { }

  static debug = (...args: any[]) => {} // console.debug
  protected abstract getValidationChecks(): ValidationCheck[]
  public isLoaded() { return this._isLoaded }
  public filePath() { return path.relative(this.bundle().workspaceRoot, this.absPath) }
  protected setBundle(bundle: Bundleish) { this._bundle = bundle /* avoid catch-22 */ }
  protected bundle() { return expect(this._bundle, 'BUG: This object was not instantiated with a Bundle. The only case that should occur is when this is a Bundle object') }
  protected ensureLoaded<T>(field: Opt<T>) {
    return expect(field, `${LOAD_ERROR} [${this.absPath}]`)
  }

  public exists() { return this._exists }
  public update(fileContent: Opt<string>): void {
    Fileish.debug(this.filePath, 'update() started')
    this._parseError = undefined
    if (fileContent === undefined) {
      this._exists = false
      this._isLoaded = true
      return
    }
    if (this.parseXML !== undefined) {
      Fileish.debug(this.filePath, 'parsing XML')

      // Development version throws errors instead of turning them into messages
      const parseXML = this.parseXML
      const fn = () => {
        const doc = this.readXML(fileContent)
        if (this._parseError !== undefined) return
        parseXML(doc)
        this._isLoaded = true
        this._exists = true
      }
      if (process.env.NODE_ENV !== 'production') {
        fn()
      } else {
        try {
          fn()
        } catch (e) {
          this._parseError = new WrappedParseError(this, e)
        }
      }
      Fileish.debug(this.filePath, 'parsing XML (done)')
    } else {
      this._exists = true
      this._isLoaded = true
    }
    Fileish.debug(this.filePath, 'update done')
  }

  // Update this Node, and collect all Parse errors
  public load(fileContent: Opt<string>) {
    Fileish.debug(this.filePath, 'load started')
    this.update(fileContent)
    Fileish.debug(this.filePath, 'load done')
  }

  private readXML(fileContent: string) {
    const locator = { lineNumber: 0, columnNumber: 0 }
    const cb = (msg: string) => {
      const pos = {
        line: locator.lineNumber - 1,
        character: locator.columnNumber - 1
      }
      this._parseError = new ParseError(this, msg, pos, pos)
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

  public getValidationErrors(): ValidationResponse {
    if (this._parseError !== undefined) {
      return new ValidationResponse(I.Set([this._parseError]))
    } else if (!this._isLoaded) {
      return new ValidationResponse(I.Set(), I.Set([this]))
    } else if (!this._exists) {
      return new ValidationResponse(I.Set(), I.Set())
    } else {
      const responses = this.getValidationChecks().map(c => ValidationResponse.continueOnlyIfLoaded(c.nodesToLoad, () => toValidationErrors(this, c.message, c.fn(c.nodesToLoad))))
      const nodesToLoad = I.Set(responses.map(r => r.nodesToLoad)).flatMap(x => x)
      const errors = I.Set(responses.map(r => r.errors)).flatMap(x => x)
      return new ValidationResponse(errors, nodesToLoad)
    }
  }

  join(type: PathType, parent: string, child: string) {
    const { dirname, join } = this._pathHelper
    let p
    let c
    switch (type) {
      case PathType.ABS_TO_REL: p = dirname(parent); c = child; break
      case PathType.COLLECTION_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join('modules', child, 'index.cnxml'); break
      case PathType.MODULE_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join(child, 'index.cnxml'); break
    }
    return join(p, c)
  }
}
