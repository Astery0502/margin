# Margin

Select a passage on a web page or PDF and open a Quick or Full discussion beside the text. Quick keeps a separate conversation for the passage. Full uses a shared document context and shows the questions and answers for the selected passage. The native side panel can return you to the source.

On macOS or 64-bit Windows, write your first question and choose **Connect an account to send**. Install **Margin Connect** for the current user, then authorize your ChatGPT subscription or enter a DeepSeek API key. DeepSeek bills usage to your API balance. Return to the passage and send your draft. Both connections can stay active. Choose a model in the discussion or set an agent’s preferred model in **Margin settings**. Manage each connection under **Accounts**.

Dictation recognizes Mandarin Chinese and English automatically. You can use both in one recording. A short pause when switching languages can improve recognition. To use a fixed language, choose it under **Margin settings → Dictation → Spoken language**. Stop recording to add the transcript to your draft.

## Install a GitHub build

1. Download `Margin-Chromium.zip` from the [GitHub release assets](https://github.com/Astery0502/margin/releases/tag/v0.1.0-preview.3) and extract it to a folder you will keep.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. Enable **Developer mode**, choose **Load unpacked**, and select the extracted `dist` folder containing `manifest.json`.
3. Open a web page or PDF and select a passage to start a discussion. To send a question, use the connection page to install the bundled Margin Connect helper for macOS 14 or later, or 64-bit Windows.

To upgrade from an earlier GitHub preview, replace the contents of your existing `dist` folder and click **Reload** on the extensions page. If Margin prompts you to update Margin Connect, run the installer from the new package. The macOS helper uses an ad hoc signature and the Windows installer is unsigned. Your operating system may prompt or block installation.

## Build and load

Use Node.js 22.19 or later, npm and curl.

```sh
npm ci
npm run build
```

For a complete local macOS build, use `npm run build:mac` with Go 1.27.4 or later and the Xcode command-line tools. It builds the extension in `dist/` and a universal installer in `dist-native/Margin-Connect-macOS.zip`. The extension includes a local download link in this build. The default signature is ad hoc for development. To create the GitHub release asset from this build on macOS, run:

```sh
ditto -c -k --norsrc --noextattr --noqtn --keepParent dist dist-native/Margin-Chromium-macOS.zip
```

Open the extensions page in Chromium, enable Developer mode, choose **Load unpacked** and select `dist/`. To read local files, enable **Allow access to file URLs** in the extension details and reload the file. Open a PDF in the browser and choose **Open PDF in Margin**.

The first build downloads a pinned Whisper Tiny model and verifies its SHA-256 checksums. Later builds reuse the verified files in `.cache/whisper-tiny/`. The extension ships its PDF.js reader, Markdown and math renderer, speech engine and model data. Recordings are transcribed on the device.

## Margin Connect on macOS and Windows

Chrome and Edge start the helper when you connect an account or send a model request. Both browsers share accounts under the same operating system user. macOS stores account records in the login keychain. Windows protects each record using current-user DPAPI under `%LOCALAPPDATA%\Margin\Connect`. On the first account operation after a macOS upgrade, Connect migrates that provider's previous account, verifies the protected copy and removes the old credential file. If prompted, finish any active tasks in the other browser and retry.

Margin Connect follows the current user's system proxy settings for sign-in, token refresh and model requests. On macOS, CFNetwork resolves each destination using the network service's manual HTTP, HTTPS or SOCKS5 settings, bypass list or PAC script. On Windows, WinHTTP resolves manual HTTP and HTTPS proxies, bypass rules and PAC scripts. The OAuth callback stays on `127.0.0.1`. If the selected proxy is unavailable, Connect reports a connection error. A refused proxy tunnel and a refusal from the token endpoint identify their respective HTTP status codes. [Apple CFNetwork proxy resolution](https://developer.apple.com/documentation/cfnetwork/cfnetworkcopyproxiesforurl%28_%3A_%3A%29) · [Microsoft WinHTTP proxy resolution](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpgetproxyforurlex)

To disconnect one provider, open **Margin settings → Accounts**. Forgetting a DeepSeek key removes the local copy. Revoke the key in your DeepSeek account to invalidate it. To uninstall Connect for both browsers, reopen the macOS installer and choose **Remove**, or use **Installed apps → Margin Connect → Uninstall** on Windows.

Build the Windows installer with Go 1.27.4 or later, NSIS 3 and `npm run build:windows`. Set `MAKENSIS` to the compiler path if needed. The output is `dist-native/Margin-Connect-Windows.exe` and includes x64 and Arm64 hosts. Windows release builders can set `MARGIN_WINDOWS_SIGN_THUMBPRINT` with SignTool on PATH. On macOS, use `MARGIN_SIGNING_IDENTITY` and `MARGIN_NOTARY_PROFILE` for Developer ID signing and notarization.

For one extension with both local installers, run `npm run build:mac` on macOS, then `node scripts/build-connect.js --windows` with NSIS available. To package the combined local build, run `ditto -c -k --norsrc --noextattr --noqtn --keepParent dist dist-native/Margin-Chromium.zip`. For separately hosted downloads, set `MARGIN_CONNECT_MAC_URL` and `MARGIN_CONNECT_WINDOWS_URL` to their HTTPS release URLs before `npm run build`.

On a clean Windows test account, build the installer and run `npm run check:windows` to exercise per-user registration, native messaging, DPAPI-backed persistence, upgrade and uninstall. Run `go test ./...` from `companion/` on either supported operating system.

## Automatic updates for store installations

Chrome and Edge can install Margin from its Chrome Web Store listing once the first release is approved. Edge may ask you to allow extensions from other stores. If you use a GitHub preview, export any discussions you want to keep and disable that copy before switching to the store listing. A different extension ID has separate browser storage. Install the release's Margin Connect helper when prompted. After that, the browser installs approved extension updates automatically when Margin is idle. [Chrome extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)

### Set up the first store release

1. Set the version in `extension/manifest.json`. On macOS or Linux with `zip` installed, run `npm ci` and `npm run build:store -- v0.1.0`, substituting the matching version tag. Upload `dist-native/Margin-Web-Store.zip` in the Chrome Web Store Developer Dashboard to create the listing. Complete its listing and privacy details. [Chrome Web Store publishing guide](https://developer.chrome.com/docs/webstore/using-api)
2. Copy the assigned extension ID into the GitHub Actions repository variable `MARGIN_CHROME_STORE_ID` and the publisher ID into `CWS_PUBLISHER_ID`. Enable the Chrome Web Store API and configure the Actions secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` for an account with publishing access.
3. Export `MARGIN_CHROME_STORE_ID` in the local environment when building **both** Margin Connect installers so they accept requests from the store extension. Attach the two installers and the store ZIP to the matching draft GitHub release as described below. Submit the first listing in the dashboard, then publish the GitHub release so the installers are available for review. Add the listing's install link to the release notes.

### Publish subsequent updates

Increase the manifest version and build the store ZIP with its matching `vMAJOR.MINOR.PATCH` tag. Attach `Margin-Web-Store.zip`, `Margin-Connect-macOS.zip` and `Margin-Connect-Windows.exe` to the draft GitHub release. The store package links to the installers on that exact tag.

Publishing the stable release triggers **Submit extension update** in GitHub Actions. It checks the assets and manifest version, uploads that ZIP to the existing store listing and submits it for review. GitHub prereleases stay on the preview channel. If submission fails, correct the reported issue and rerun the failed job. The workflow recognizes a version already in review or published.

## Browser checks

`npm run check` builds the extension and runs the floating-window, PDF, discussion, local-file and dictation checks. The full suite uses Microsoft Edge on macOS, isolated browser profiles and a synthesized test voice. The discussion check substitutes the account and model transport in a temporary copy of the extension. It exercises task execution, streaming, source cleanup and the native side panel without a live subscription.

After building, `npm run check:connect` uses a separate temporary Edge profile, signed fixture identity tokens and a local streaming server to exercise the connection UI, OAuth, refresh, revocation, DeepSeek key validation and model switching with both accounts connected. A separate live check on Apple Silicon verified ChatGPT authorization, streamed output in a Full PDF discussion, stopping from the side panel and locating the selected passage.

The PDF fixture comes from the [PDF.js sample collection](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf).
