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

## Reskinning a project

1. Copy the whole folder.
2. Replace `data/content.csv`.
3. Open `public/theme.css` and change the ~12 variables (surfaces, text,
   accent, fonts, radius). Four ready-made palettes — Maroon (default), Navy,
   Cream, Forest — are included in the comments.
4. Optionally flip `MODE` in `public/config.js` from `'deck'` (swipe,
   story-style) to `'feed'` (one vertical scroll).

The layout, spacing, and interactions stay identical across projects — only
the skin changes.
