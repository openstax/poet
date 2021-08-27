import { JobRunner, URIPair } from './job-runner'

JobRunner.debug = () => {} // Turn off logging

describe('Job Runner', () => {
  const context: URIPair = { workspace: 'aaa', doc: 'bbb' }
  let jobRunner = new JobRunner()
  beforeEach(() => {
    jobRunner = new JobRunner()
  })
  it('runs newly added jobs first (stack)', async () => {
    const appendLog: string[] = []
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job1') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job2') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job3') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job4') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job5') })
    expect(appendLog).toEqual([]) // Nothing immediately executes (otherwise jobs would keep restacking themselves)
    await jobRunner.done()
    expect(appendLog).toEqual(['Job5', 'Job4', 'Job3', 'Job2', 'Job1'])
  })
  it('prioritizes fast jobs', async () => {
    const appendLog: string[] = []
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Initial') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Fast1') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Slow1'), slow: true })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Fast2') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Slow2'), slow: true })
    expect(appendLog).toEqual([])
    await jobRunner.done()
    expect(appendLog).toEqual(['Fast2', 'Fast1', 'Initial', 'Slow2', 'Slow1'])
  })
  it('done() waits even when there are no jobs running', async () => {
    await jobRunner.done()
  })
  it('continues jobs when one throws an error', async () => {
    const appendLog: string[] = []
    await expect(async () => {
      jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Initial') })
      jobRunner.enqueue({ type: 'testcheck', context, fn: () => { throw new Error('intentional_error')} })
      jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Fast1') })
      expect(appendLog).toEqual([])
      await jobRunner.done()
    }).rejects.toThrow('intentional_error')
    await jobRunner.done()
    expect(appendLog).toEqual(['Fast1', 'Initial'])
  })
})
