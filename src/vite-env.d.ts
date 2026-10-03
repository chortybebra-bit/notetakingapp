/// <reference types="vite/client" />

declare module 'y-indexeddb' {
  import type { Doc } from 'yjs'
  export class IndexeddbPersistence {
    whenSynced: Promise<unknown>
    constructor(name: string, doc: Doc)
    destroy(): void
  }
}
