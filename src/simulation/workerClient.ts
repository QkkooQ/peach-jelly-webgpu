import PeachWorker from './peachWorker?worker&inline'
import type { WorkerCommand, WorkerMessage } from './types'

export class PeachSimulationClient {
  private readonly worker = new PeachWorker()
  private listener: ((message: WorkerMessage) => void) | null = null

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.listener?.(event.data)
    }
  }

  subscribe(listener: (message: WorkerMessage) => void) {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  send(command: WorkerCommand) {
    this.worker.postMessage(command)
  }

  dispose() {
    this.worker.terminate()
  }
}
