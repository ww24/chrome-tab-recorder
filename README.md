# chrome-tab-recorder

[<img alt="GMO OSS Security Program" src="https://security-api.gmo.jp/static/img/oss_badge_ol-CyzWkcK8.svg" height="18px">](https://group.gmo/security/oss-support/)

Google Chrome Extensions Tab Recorder

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/instant-tab-recorder/giebbnikpnedbdojlghnnegpfbgdecmi)

## Development

### Build

```sh
npm install
npm run build
```

### Directory structure

```text
.
├── README.md   ... this file
├── docs        ... GitHub Pages directory
├── extension   ... Chrome Extensions entrypoint
└── src         ... source files
```

### References

- <https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture>
- <https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.tabcapture-recorder>
- <https://web.dev/articles/origin-private-file-system>
