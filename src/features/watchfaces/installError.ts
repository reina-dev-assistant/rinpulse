/**
 * The watch refuses a face Huawei did not sign with code 100014 (Huawei Health reads 100007 and 100014 as a signature failure).
 * The native message names the code; the screen shows a short localized sentence instead, and the raw code stays in the
 * native support log, which is written where the watch answered.
 */
export function isSignatureRefusal(message: string): boolean {
  return /\b100014\b/.test(message);
}

/** The text to show for a failed install: `signatureText` for a refused signature, else the native message. */
export function installFailureText(message: string, signatureText: string): string {
  return isSignatureRefusal(message) ? signatureText : message;
}
