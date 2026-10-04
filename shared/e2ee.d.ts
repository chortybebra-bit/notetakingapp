export type FolioKey = CryptoKey | Uint8Array

export function deriveKey(secret: string, room: string): Promise<FolioKey>
export function encryptBytes(key: FolioKey, data: Uint8Array): Promise<string>
export function decryptBytes(key: FolioKey, blob: string): Promise<Uint8Array>
export function roomId(secret: string, label: string): Promise<string>
export function seal(key: FolioKey, data: Uint8Array): Promise<string>
export function open(key: FolioKey, blob: string): Promise<Uint8Array>
