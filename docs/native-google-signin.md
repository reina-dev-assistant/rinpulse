# Native Google Sign-In (Android)

JoyoFit's Google option of "Masuk dengan JoyoRogo" uses Google's account picker (Play services) on Android and sends the
ID token to JoyoRogo's better-auth (`signIn.social({ provider: "google", idToken })`), so login no longer depends on
Chrome Custom Tabs. iOS keeps Sign in with Apple. The full design, fallback table, Google Cloud client list and
"add the SHA-1 when a signing key changes" rule are in JoyoRogo's `docs/native-google-signin.md`.

JoyoFit specifics:

- Code: `src/cloud/googleNative.ts` (pure logic), `googleNativeDevice.ts` (adapter), `CloudProvider.signIn`; tests in
  `googleNative.test.ts`.
- Package `com.joyodigitama.joyofit`; registered SHA-1s: Play signing `F1:A1:EA:C2`, upload / sideload `32:92:14:D5`,
  previous `E1:F8:DD:90` and `FE:CF:31:EC`. A build signed with any other key falls back to the browser flow
  (developer error `10`, logged by `cloudLog`).
- Needs a new store build (native module); `google-services.json` is unchanged; no config plugin entry.
- An OTA on an older binary has no `RNGoogleSignin` module and keeps the browser flow.
