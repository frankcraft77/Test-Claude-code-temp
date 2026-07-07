# Story-Card Template

A mobile-first, self-hosted web template that turns a CSV file into an elegant
swipeable deck of story cards — and can also **collect input from the public**
(short text, long text, email, multiple choice) into a separate CSV on your
server. No frameworks, no build step, no third-party services.

```
┌──────────────────────────┐
│ ‹  The Applause Tax    ✕ │   top bar (title follows the current card)
│ ── ── ━━━━━━ ──          │   segmented progress
│ ┌──────────────────────┐ │
│ │  Large serif text    │ │   one CSV row = one card
│ │  …optional image…    │ │
│ │  ↗              🔖   │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

## Quick start

```bash
docker compose up --build
# open http://localhost:8080
```

Or without Docker (Node 18+):

```bash
node server.js
```

> The container runs as the unprivileged `node` user (uid 1000). If
> submissions return a 500, make the mounted folder writable for it:
> `sudo chown -R 1000:1000 data`

For production behind HTTPS, use `docker-compose.prod.yml` + `Caddyfile.example`
(Caddy terminates TLS with automatic Let's Encrypt certificates).

## Shared hosting — file access only, no Docker

The frontend is plain static files and the backend can be one PHP file, so the
template also runs on any host where you can only upload files (cPanel, FTP,
SFTP). Upload this layout into the subdomain's document root:

```
index.html  style.css  theme.css  config.js  app.js     from public/
assets/                                                  from public/assets/
content.csv                                              your content
images/                                                  your photos
submit.php  .htaccess                                    from shared-hosting/
```

Then edit `config.js` so the app reads files directly and posts to PHP:

```js
CONTENT_URL: 'content.csv',
SUBMIT_URL: 'submit.php'
```

Submissions are appended to `storydeck-responses.csv` **one level above the
document root**, where nobody can download them; download via your file
manager or SFTP. If your host doesn't allow writing there, open `submit.php`
and switch to the in-webroot line — the included `.htaccess` then blocks
public access to the file.

No PHP either? Set `SUBMIT_URL: ''` — input cards are skipped and the site
runs as a pure static story deck.

## How it works

| Path | Purpose |
|---|---|
| `data/content.csv` | Your content. One row = one card. Edit on the host — no rebuild needed. |
| `data/responses.csv` | Created automatically; every public submission is appended here. Never shown on the site. |
| `public/theme.css` | **The only file you edit to reskin a project** (colors, fonts, radius). |
| `public/config.js` | Per-project settings: `MODE` (`'deck'` or `'feed'`), `APP_TITLE`, `CLOSE_URL`. |
| `public/style.css` | The design system. Leave it alone so all projects stay consistent. |
| `server.js` | Zero-dependency Node server: static files + the two tiny API routes. |

## The CSV schema

Header row is required: `type,title,text,image,options,field_key`

| Column | Meaning |
|---|---|
| `type` | The **keyword** that picks the card design (see below). |
| `title` | Shown in the top bar while this card is on screen. |
| `text` | Card body. Wrap in quotes to include blank lines → paragraphs. For input cards this is the question. |
| `image` | Optional image URL (or a path like `assets/illustration.svg`). |
| `options` | For `choice` cards: options separated by `\|`, e.g. `Yes\|No\|Maybe`. |
| `field_key` | Column name the answer is stored under in `responses.csv`. |

### Type keywords

| Keyword | Card |
|---|---|
| `text` (or empty) | Story card: serif body text + optional image. |
| `input` | Sleek single-line text field. |
| `longtext` | Auto-growing textarea for longer answers. |
| `email` | Email field with validation. |
| `choice` | Tappable pill buttons from the `options` column. |

Submissions land in `data/responses.csv` as `timestamp,field_key,value` rows —
open it in Excel/Numbers or filter by `field_key`. The server only accepts
`field_key`s that actually appear in `content.csv`, caps submission size, and
rate-limits by IP.

## Images

The `image` column accepts three kinds of value:

| Value | Where the file lives |
|---|---|
| `images/photo.jpg` | **`data/images/` on your server** — the drop-in folder (see below). |
| `assets/pic.svg` | `public/assets/`, baked into the app/Docker image. |
| `https://…` | Any external URL. |

**The drop-in folder is the intended workflow for photos.** `data/` is
volume-mounted, so upload photos straight to the host — no rebuild, no
restart:

```bash
scp holiday-*.jpg you@yourserver:/path/to/project/data/images/
```

Each file is then served at `/images/<filename>`, and that's exactly what you
put in the CSV: `data/images/team.jpg` → `images/team.jpg` in the `image`
column. Filenames are the URLs, so keep them lowercase with no spaces.

## Reskinning a project

1. Copy the whole folder.
2. Replace `data/content.csv`.
3. Open `public/theme.css` and change the ~13 flat color variables (surfaces,
   text, accent, fonts, radius). style.css derives all gradients, sheens, and
   shadows from them automatically with `color-mix()`, so flat colors in →
   layered depth out. The default palette is Midnight Ink (dark blue-black,
   amber accent); ready-made presets — Warm Charcoal, Cream, Maroon, Sky —
   are in the comments. To recolor just the accent (buttons, pills, progress,
   focus rings), change the single `--accent` line; alternates that work on
   the dark surfaces are listed right next to it.
4. Optionally flip `MODE` in `public/config.js` from `'deck'` (swipe,
   story-style) to `'feed'` (one vertical scroll).

The layout, spacing, and interactions stay identical across projects — only
the skin changes.
