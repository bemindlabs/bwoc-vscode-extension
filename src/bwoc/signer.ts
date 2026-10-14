// Ed25519 request signing for the bwocd control daemon, ported from the
// chrome-extension's signer.ts to Node (node:crypto instead of WebCrypto).
//
// The private key is generated on first use and stored in VS Code SecretStorage
// (the OS keychain), never on disk in plaintext. Each install is its own
// controller identity that self-enrolls (POST /enroll) and is approved by the
// operator with chosen capabilities. The signed-payload format is owned by
// canonical.ts (byte-identical to cc-signing); here we do key management + the
// Ed25519 operation + header assembly.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from "node:crypto";

import { randomNonceHex, sha256Hex, signingPayload } from "./canonical";

/** Secret-backed store (VS Code `context.secrets` satisfies this). */
export interface KeyStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
}

/** Non-secret persistence (VS Code `context.globalState` via a thin adapter). */
export interface ConfigStore {
  get(key: string): string | undefined;
  update(key: string, value: string): Thenable<void>;
}

export interface Identity {
  controllerId: string;
  publicKeyHex: string;
}

const SECRET_PRIVATE_KEY = "bwoc.controller.privateKeyPem";
const CFG_CONTROLLER_ID = "bwoc.controller.id";
const CFG_PUBLIC_KEY = "bwoc.controller.publicKeyHex";

/** The raw 32-byte Ed25519 public key as hex. It is the JWK `x` (base64url) —
 *  the same bytes WebCrypto's raw export yields, which bwocd stores/compares. */
function rawPublicHex(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export class Signer {
  constructor(
    private readonly secrets: KeyStore,
    private readonly config: ConfigStore,
  ) {}

  /** Ensure a keypair + controller id exist; generate on first run. Idempotent. */
  async ensureIdentity(): Promise<Identity> {
    const pem = await this.secrets.get(SECRET_PRIVATE_KEY);
    const controllerId = this.config.get(CFG_CONTROLLER_ID);
    const publicKeyHex = this.config.get(CFG_PUBLIC_KEY);
    if (pem) {
      // The key in SecretStorage is the identity: never rotate it just because
      // the non-secret config was lost — rebuild the public half from it.
      const pubHex = rawPublicHex(createPrivateKey(pem));
      if (controllerId && publicKeyHex === pubHex) {
        return { controllerId, publicKeyHex };
      }
      const id = controllerId && !publicKeyHex ? controllerId : `vscode-${pubHex.slice(0, 8)}`;
      await this.config.update(CFG_CONTROLLER_ID, id);
      await this.config.update(CFG_PUBLIC_KEY, pubHex);
      return { controllerId: id, publicKeyHex: pubHex };
    }

    // No key: a fresh keypair is a fresh identity. Never pair it with an old
    // controller id — bwocd has that id enrolled under the previous public key.
    const { privateKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    await this.secrets.store(SECRET_PRIVATE_KEY, privatePem);
    const pubHex = rawPublicHex(privateKey);
    const id = `vscode-${pubHex.slice(0, 8)}`;
    await this.config.update(CFG_CONTROLLER_ID, id);
    await this.config.update(CFG_PUBLIC_KEY, pubHex);
    return { controllerId: id, publicKeyHex: pubHex };
  }

  private async privateKey(): Promise<KeyObject> {
    const pem = await this.secrets.get(SECRET_PRIVATE_KEY);
    if (!pem) {
      throw new Error("no controller key — call ensureIdentity() first");
    }
    return createPrivateKey(pem);
  }

  /**
   * Build the five `X-BWOC-*` headers for one request. `canonical` must come
   * from `canonicalPath()`; `body` is the raw request body bytes (empty for GET).
   */
  async buildSignedHeaders(
    method: string,
    canonical: string,
    body: Uint8Array,
  ): Promise<Record<string, string>> {
    const { controllerId } = await this.ensureIdentity();
    const nonce = randomNonceHex();
    const ts = new Date().toISOString();
    const bodyHash = sha256Hex(body);
    const payload = signingPayload(controllerId, method, canonical, nonce, ts, bodyHash);
    const signature = edSign(null, Buffer.from(payload), await this.privateKey()).toString("hex");
    return {
      "X-BWOC-Agent": controllerId,
      "X-BWOC-Nonce": nonce,
      "X-BWOC-Timestamp": ts,
      "X-BWOC-Body-SHA256": bodyHash,
      "X-BWOC-Signature": signature,
    };
  }
}
