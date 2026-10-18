import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { authClient } from '@/cloud/auth';
import { t } from '@/i18n';
import { CLOUD_CONFIGURED, CLOUD_URL, JOYOROGO_URL } from '@/cloud/config';
import { rogoCall } from '@/cloud/rogo';
import { NotSignedInError } from '@/cloud/api';
import { isIos } from '@/components/IosUnavailable';

/** JoyoFit's bundle id: the audience of its Apple identity tokens and the client id of its authorization codes. */
const APPLE_BUNDLE_ID = 'com.joyodigitama.joyofit';

/** The person closed the Apple sheet; not a failure. */
function isCanceled(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : undefined;
  return code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED';
}

export const appleSignInAvailable = (): Promise<boolean> =>
  isIos ? AppleAuthentication.isAvailableAsync().catch(() => false) : Promise.resolve(false);

/**
 * Native Sign in with Apple, then better-auth's `apple` provider verifies the identity token on the JoyoRogo server
 * (audience = this app's bundle id). Returns false when the Apple sheet was closed, throws with a message otherwise.
 */
export async function signInWithApple(): Promise<boolean> {
  try {
    // Apple puts the SHA-256 of this value in the token's nonce claim; the server hashes the raw nonce and compares.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error(t('common:errors.appleNoData'));
    // Apple returns the name only on the very first authorization, and not inside the token.
    const { givenName, familyName } = credential.fullName ?? {};
    const { error } = await authClient.signIn.social({
      provider: 'apple',
      idToken: {
        token: credential.identityToken,
        nonce: rawNonce,
        ...(givenName || familyName
          ? { user: { name: { firstName: givenName ?? undefined, lastName: familyName ?? undefined } } }
          : {}),
      },
    });
    if (error) throw new Error(error.message || t('common:errors.appleFailed'));
    return true;
  } catch (e) {
    if (isCanceled(e)) return false;
    throw e;
  }
}

/**
 * Deletes what the current session owns: the JoyoFit cloud data (`DELETE /v1/account` on the JoyoFit Worker), then the
 * JoyoRogo account (`privacy.deleteMyAccount` on the JoyoRogo server: its data, photos, linked logins, sessions). An account that signs in with Apple needs a fresh authorization code so the
 * server can revoke the Sign in with Apple token, so Apple's sheet opens first. Returns false when that sheet was
 * closed; nothing is deleted then.
 */
export async function deleteJoyoRogoAccount(): Promise<boolean> {
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();

  let appleAuthorizationCode: string | undefined;
  if (isIos) {
    const accounts = await authClient.listAccounts();
    if ((accounts.data ?? []).some((a) => a.providerId === 'apple')) {
      try {
        const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
        if (!credential.authorizationCode) throw new Error(t('common:errors.appleNoCode'));
        appleAuthorizationCode = credential.authorizationCode;
      } catch (e) {
        if (isCanceled(e)) return false;
        throw e;
      }
    }
  }

  // JoyoFit's own cloud data first: it is keyed by the JoyoRogo user id and the session that proves who is asking
  // ends with the account. Repeatable, so a failure further down leaves nothing half-deleted for good.
  if (CLOUD_CONFIGURED) {
    const wiped = await fetch(`${CLOUD_URL}/v1/account`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Accept: 'application/json' },
      credentials: 'omit',
    });
    if (!wiped.ok && wiped.status !== 401) {
      throw new Error(t('common:errors.deleteCloudFailed', { status: wiped.status }));
    }
  }

  // The synced preferences, templates, routes and health records live in JoyoRogo's `sync_record` and go the same way.
  await rogoCall<unknown>('sync/wipe', { ns: 'fit' });

  const response = await fetch(`${JOYOROGO_URL}/rpc/privacy/deleteMyAccount`, {
    method: 'POST',
    headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: appleAuthorizationCode ? { appleAuthorizationCode, appleClientId: APPLE_BUNDLE_ID } : {},
    }),
    credentials: 'omit',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { json?: { message?: unknown } } | null;
    const message = body?.json?.message;
    throw new Error(
      typeof message === 'string' && message
        ? message
        : response.status === 401
          ? t('common:errors.sessionRejectedRetry')
          : t('common:errors.deleteAccountFailed', { status: response.status }),
    );
  }
  return true;
}
