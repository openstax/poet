import path from 'path'
import { Fileish } from './model/fileish'
import { expectValue, Opt, profileAsync } from './model/utils'

export interface URIPair { workspace: string, doc: string }
export interface Job {
  type: string
  context: Fileish | URIPair
  fn: () => Promise<any> | any
  slow?: boolean
}

export class JobRunner {
  private _currentPromise: Opt<Promise<void>>
  private readonly fastStack: Job[] = []
  private readonly slowStack: Job[] = []

  public static debug = console.debug
  public enqueue(job: Job) {
    job.slow === true ? this.slowStack.push(job) : this.fastStack.push(job)
    this.process()
  }

  public async done(): Promise<any> { return this._currentPromise === undefined ? await Promise.resolve() : await this._currentPromise }

  private length() {
    return this.fastStack.length + this.slowStack.length
  }

  private pop(): Opt<Job> {
    return this.fastStack.pop() ?? this.slowStack.pop()
  }

  private process() {
    if (this._currentPromise !== undefined) return // job is running
    this._currentPromise = new Promise((resolve, reject) => {
      setImmediate(() => this.tickWithCb(resolve, err => {
        JobRunner.debug(err)
        this._currentPromise = undefined
        reject(err)
        if (!this.done()) this.process() // keep processing jobs if there are more
      }))
    })
  }

  // In order to support `await this.done()` keep daisy-chaining the ticks
  private tickWithCb(resolve: () => void, reject: (err: any) => void) {
    const current = this.pop()
    if (current !== undefined) {
      this.tick(current).then(() => this.tickWithCb(resolve, reject), reject)
    } else {
      resolve()
      this._currentPromise = undefined
    }
  }

  private async tick(current: Job) {
    const [ms] = await profileAsync(async () => {
      const c = expectValue(current, 'BUG: nothing should have changed in this time')
      JobRunner.debug('[JOB_RUNNER] Starting job', c.type, this.toString(c.context), c.slow === true ? '(slow)' : '(fast)')
      await c.fn()
    })
    JobRunner.debug('[JOB_RUNNER] Finished job', current.type, this.toString(current.context), 'took', ms, 'ms')
    if (this.length() === 0) {
      JobRunner.debug('[JOB_RUNNER] No more pending jobs. Taking a nap.')
    } else {
      JobRunner.debug('[JOB_RUNNER] Remaining jobs', this.length())
    }
  }

  toString(nodeOrString: Fileish | URIPair) {
    if (nodeOrString instanceof Fileish) { return nodeOrString.workspacePath } else return path.relative(nodeOrString.workspace, nodeOrString.doc)
  }
}
