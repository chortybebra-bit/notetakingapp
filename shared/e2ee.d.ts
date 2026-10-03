export function deriveKey(secret: string, room: string): Promise<CryptoKey>
export function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<string>
export function decryptBytes(key: CryptoKey, blob: string): Promise<Uint8Array>
export function roomId(secret: string, label: string): Promise<string>
export function seal(key: CryptoKey, data: Uint8Array): Promise<string>
export function open(key: CryptoKey, blob: string): Promise<Uint8Array>
