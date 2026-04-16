/**
 * Workaround for vedur.is serving an incomplete TLS certificate chain.
 * Their server sends only the leaf cert, omitting the intermediate
 * (GlobalSign GCC R6 AlphaSSL CA 2025). Most browsers cache intermediates
 * and work around this, but Node.js and curl fail verification.
 *
 * This module patches tls.createSecureContext to inject the missing
 * intermediate so fetch() calls to www.vedur.is / en.vedur.is succeed.
 *
 * The bundled cert was downloaded from the AIA responder URL embedded in
 * the leaf cert. To refresh manually:
 *   curl -s http://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt \
 *     | openssl x509 -inform DER -outform PEM > certs/vedur-is-intermediate.pem
 *
 * Bundled cert expires: 2027-05-21. When vedur.is fixes their chain this
 * patch becomes a harmless no-op (the extra CA is simply redundant).
 */

import tls from "node:tls";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "node:crypto";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_PATH = resolve(__dirname, "..", "certs", "vedur-is-intermediate.pem");

/** Thirty days in ms — warn when cert is expiring soon. */
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

function loadCert(): string | undefined {
  if (!existsSync(CERT_PATH)) return undefined;

  const pem = readFileSync(CERT_PATH, "utf8");

  try {
    const x509 = new X509Certificate(pem);
    const expiresAt = new Date(x509.validTo).getTime();
    const now = Date.now();

    if (expiresAt <= now) {
      log.warn("vedur.is intermediate cert has expired — TLS patch skipped", {
        expired: x509.validTo,
        refreshCmd:
          "curl -s http://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt | openssl x509 -inform DER -outform PEM > certs/vedur-is-intermediate.pem",
      });
      return undefined;
    }

    if (expiresAt - now < EXPIRY_WARNING_MS) {
      log.warn("vedur.is intermediate cert expires soon", {
        expires: x509.validTo,
      });
    }
  } catch {
    // If X509Certificate isn't available (Node <15) or parsing fails,
    // still use the cert — worst case the TLS stack rejects it itself.
  }

  return pem;
}

const extraCert = loadCert();

if (extraCert) {
  const cert = extraCert;
  const _createSecureContext = tls.createSecureContext;

  tls.createSecureContext = function (
    options?: tls.SecureContextOptions,
  ): tls.SecureContext {
    const ctx = _createSecureContext.call(this, options);
    // addCACert is on the internal OpenSSL context — same mechanism
    // Node uses for NODE_EXTRA_CA_CERTS processing.
    (ctx.context as unknown as { addCACert(cert: string): void }).addCACert(
      cert,
    );
    return ctx;
  };
}
