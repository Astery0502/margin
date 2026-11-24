# Margin

Select a passage on a web page or PDF and open a Quick or Full discussion beside the text. Quick keeps a separate conversation for the passage. Full uses a shared document context and shows the questions and answers for the selected passage. The native side panel can return you to the source.

On macOS, write your first question and choose **Connect ChatGPT to send**. Download and open **Margin Connect** once, then approve Margin in ChatGPT. Return to the passage and send your draft. Manage or disconnect the account in **Margin settings → Manage ChatGPT connection**. While disconnected you can still read, draft, capture screenshots and dictate.

## Install a GitHub build

Download the preview from [GitHub Releases](https://github.com/Astery0502/margin/releases). The macOS release asset is `Margin-Chromium-macOS.zip`. Extract it, open the extensions page in Chrome or Edge, enable **Developer mode**, choose **Load unpacked**, and select the extracted `dist` folder. Keep that folder in place. The connection page offers Margin Connect from the same package. The initial build uses an ad hoc signature. Gatekeeper may block the first launch of the downloaded app.

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

## Margin Connect on macOS

Chrome and Edge start the helper on demand for account access and model requests. It stores renewable credentials in an owner-only file under `~/Library/Application Support/Margin/Connect/`. To remove it, disconnect in settings, remove that directory and delete `dev.margin.connect.json` from the `NativeMessagingHosts` directories under `~/Library/Application Support/Google/Chrome/` and `~/Library/Application Support/Microsoft Edge/`.

## Browser checks

`npm run check` builds the extension and runs the floating-window, PDF, discussion, local-file and dictation checks. The full suite uses Microsoft Edge on macOS, isolated browser profiles and a synthesized test voice. The discussion check substitutes the account and model transport in a temporary copy of the extension. It exercises task execution, streaming, source cleanup and the native side panel without a live subscription.

After building, `npm run check:connect` uses a separate temporary Edge profile, signed fixture identity tokens and a local streaming server to exercise the connection UI, OAuth, refresh, revocation and SDK transport. A separate live check on Apple Silicon verified ChatGPT authorization, streamed output in a Full PDF discussion, stopping from the side panel and locating the selected passage.

The PDF fixture comes from the [PDF.js sample collection](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf).
