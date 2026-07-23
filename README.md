# ManifestScan — FedEx Tracking Number Reader

A small static web app: drag in photos of package labels, and it reads
every **"Tracking ID"** it finds and lists the numbers next to it — built
so it can be hosted for free on GitHub Pages.

**Everything happens in your browser.** Photos are never uploaded to a
server. OCR runs on-device using [Tesseract.js](https://github.com/naptha/tesseract.js)
(a WebAssembly build of the Tesseract OCR engine, fetched from a CDN the
first time the page loads). Closing the tab discards everything — there's
no storage, database, or backend.

## How it works

1. Drop one or more photos onto the panel, or tap it to choose files.
2. Each photo is read locally and scanned for the text "Tracking ID"
   (also matches "Tracking No", "Tracking Number", "Tracking #", with or
   without a colon).
3. The digits that immediately follow the label are pulled out — this
   handles labels where FedEx prints the number in spaced groups
   (e.g. `7712 3456 7890`).
4. A photo can contain more than one tracking number; every match is
   captured as its own line in the manifest.
5. Since all your numbers are FedEx tracking IDs, they should share one
   digit length. The app auto-detects the most common length across
   everything scanned and flags any number that doesn't match, so a
   misread digit doesn't slip through unnoticed. You can also lock the
   expected length manually (12 / 15 / 20 / 22 / 34 digits) from the
   dropdown if you already know it.
6. Fix any number inline (OCR sometimes confuses things like `0`/`O` or
   `1`/`I`), then copy the whole list or export it as a CSV.

## Running it locally

No build step — it's plain HTML/CSS/JS. Just serve the folder:

```bash
cd fedex-scanner
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly with `file://` also mostly works, but some
browsers restrict camera-image handling under `file://`, so a local
server is more reliable.)

## Deploying to GitHub Pages

1. Create a new GitHub repository (public, so Pages can serve it — or
   private on a paid plan).
2. Push these files to the repository root (or to a `/docs` folder — see
   below):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a
   branch".
5. Set **Branch** to `main` and the folder to `/ (root)` (or `/docs` if
   you put the files there), then **Save**.
6. GitHub will publish the site at
   `https://<your-username>.github.io/<your-repo>/` within a minute or
   two — refresh the Pages settings screen to see the live link.

No secrets, API keys, or server config are needed — the whole app is
static files plus a CDN-hosted OCR library.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and layout |
| `style.css` | Visual design |
| `app.js` | Drag-and-drop intake, OCR orchestration, extraction logic, manifest UI |

## Notes on accuracy

OCR on phone photos is never perfect — glare, blur, and low light all
hurt accuracy. A few things that help:
- Fill the frame with the label and keep it flat/in-focus.
- Good, even lighting (avoid glare across the barcode/number).
- If a number comes out with an obviously wrong digit count, it'll be
  flagged in the manifest — click into the field and correct it by hand.
