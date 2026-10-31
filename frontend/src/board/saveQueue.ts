import { mergePatches, type BoardPatch } from './model.ts'

/** One queue per board: serialize writes and retain newer edits on retry. */
export class BoardSaveQueue {
  private pending: BoardPatch = {}
  private inFlight: Promise<boolean> | null = null
  error: unknown = null
  private save: (patch: BoardPatch) => Promise<unknown>

  constructor(save: (patch: BoardPatch) => Promise<unknown>) {
    this.save = save
  }

  enqueue(patch: BoardPatch) {
    this.pending = mergePatches(this.pending, patch)
  }

  snapshot(): BoardPatch {
    return this.pending
  }

  async flush(): Promise<boolean> {
    if (this.inFlight) {
      if (!(await this.inFlight)) return false
      return this.flush()
    }
    if (!Object.keys(this.pending).length) return true
    const patch = this.pending
    this.pending = {}
    this.inFlight = (async () => {
      try {
        await this.save(patch)
        this.error = null
        return true
      } catch (error) {
        this.pending = mergePatches(patch, this.pending)
        this.error = error
        return false
      }
    })()
    const saved = await this.inFlight
    this.inFlight = null
    return saved ? this.flush() : false
  }
}
