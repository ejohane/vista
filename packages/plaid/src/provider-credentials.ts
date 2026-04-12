const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizeBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = normalized.length % 4;

  if (remainder === 0) {
    return normalized;
  }

  return `${normalized}${"=".repeat(4 - remainder)}`;
}

function decodeBase64(value: string) {
  const binary = atob(normalizeBase64(value));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join(
    "",
  );

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

async function importEncryptionKey(secret: string) {
  const keyBytes = decodeBase64(secret.trim());

  if (keyBytes.byteLength !== 32) {
    throw new Error(
      "Provider token encryption key must decode to exactly 32 bytes.",
    );
  }

  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

export async function encryptProviderToken(args: {
  keyVersion?: number;
  plaintext: string;
  secret: string;
}) {
  const keyVersion = args.keyVersion ?? 1;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importEncryptionKey(args.secret);
  const encryptedBytes = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        iv,
        name: "AES-GCM",
      },
      cryptoKey,
      textEncoder.encode(args.plaintext),
    ),
  );

  return `v${keyVersion}.${encodeBase64(iv)}.${encodeBase64(encryptedBytes)}`;
}

export async function decryptProviderToken(args: {
  encryptedToken: string;
  secret: string;
}) {
  const match = /^v(?<keyVersion>\d+)\.(?<iv>[^.]+)\.(?<payload>[^.]+)$/.exec(
    args.encryptedToken,
  );

  if (!match?.groups?.iv || !match.groups.payload) {
    throw new Error("Encrypted provider token is malformed.");
  }

  const cryptoKey = await importEncryptionKey(args.secret);

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        iv: decodeBase64(match.groups.iv),
        name: "AES-GCM",
      },
      cryptoKey,
      decodeBase64(match.groups.payload),
    );

    return textDecoder.decode(decrypted);
  } catch {
    throw new Error("Failed to decrypt provider token.");
  }
}
