/**
 * AES-GCM 토큰 암호화/복호화
 * GMAIL_ENCRYPTION_KEY 환경변수(32바이트 hex) 사용
 * 저장 형식: "iv_hex:ciphertext_hex"
 */

// new ArrayBuffer(n)을 명시적으로 사용해 Uint8Array<ArrayBuffer> 타입 확보
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getKey(): Promise<CryptoKey> {
  const keyHex = process.env.GMAIL_ENCRYPTION_KEY;
  if (!keyHex) throw new Error("GMAIL_ENCRYPTION_KEY 환경변수가 없습니다");
  const keyBytes = hexToBytes(keyHex.slice(0, 64)); // 32바이트 = 256비트
  return crypto.subtle.importKey(
    "raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]
  );
}

/** 평문 → "iv:ciphertext" 암호화 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/** "iv:ciphertext" → 평문 복호화 */
export async function decryptToken(encrypted: string): Promise<string> {
  const [ivHex, ciphertextHex] = encrypted.split(":");
  if (!ivHex || !ciphertextHex) throw new Error("잘못된 토큰 형식");
  const key = await getKey();
  const iv = hexToBytes(ivHex);
  const ciphertext = hexToBytes(ciphertextHex);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/** 암호화된 토큰인지 확인 (iv:ciphertext 형식) */
export function isEncrypted(value: string): boolean {
  return value.includes(":") && value.split(":")[0].length === 24;
}
