# GTM Studio

**GTM** stands for **go-to-market**: everything you do to get a product in front of the people it is for, once it exists. For most developers that part is harder than building the product. You ship, you post a link once, nothing happens, and the project quietly dies.

GTM Studio is a [Claude Code](https://code.claude.com) plugin for that moment. You install it inside the repository of a product you built (often with Claude Code itself), and it:

1. **Reads your code** to understand what the product does, who it is for, what it looks like and what language it speaks.
2. **Defines a brand voice** in `marketing/brand.md`, from the code plus five questions it asks you.
3. **Plans four weeks of LinkedIn content** (three posts a week) in `marketing/calendar.md` and `calendar.json`.
4. **Writes every post**, ready to copy: text, carousel slides as PNG and PDF in your brand's colors and fonts, real screenshots of your app, and a publishing checklist.
5. **Builds `marketing/calendar.html`**, a local page where you review each post with its images and checklist.

GTM Studio **never publishes anything**. It prepares, organizes and hands over. You upload.

This first version targets LinkedIn. The architecture is ready for other networks: adding one means adding a writer agent and a folder of templates (see [Add a network](#add-a-network)).

## Requirements

- Claude Code 2.1 or later.
- Node.js 20 or later (any LTS).
- A Chromium-based browser for rendering: Playwright's own Chromium (one command, see below), or Google Chrome or Microsoft Edge already installed.

The only dependency is Playwright. No external services, no paid APIs. The only network calls the scripts make are to Google Fonts when your brand uses them, and to your own app when capturing screenshots.

## Install

Add the marketplace once, then install the plugin:

```bash
claude plugin marketplace add jaimegarfia/gtm-studio
claude plugin install gtm-studio@gtm-studio
```

Claude Code installs Playwright's npm package automatically. The browser binary is a separate download; run it once from the plugin folder if you do not have Chrome or Edge:

```bash
cd ~/.claude/plugins/cache/gtm-studio/gtm-studio/*/
npx playwright install chromium
```

`/gtm-studio:doctor` tells you whether anything is missing and prints the exact command for your machine.

## Try it locally (without installing)

Clone the repository, install Playwright inside it, and load it for one session from the project you want to market:

```bash
git clone https://github.com/jaimegarfia/gtm-studio
cd gtm-studio && npm install && npx playwright install chromium

cd /path/to/your-product
claude --plugin-dir /path/to/gtm-studio
```

Inside the session, `/gtm-studio:doctor` confirms the plugin loaded. Edit the plugin files and run `/reload-plugins` to pick up changes. `claude plugin validate /path/to/gtm-studio` checks the manifests, and `npm test` inside the plugin runs the script tests (the browser tests skip themselves when no browser is available).

## Commands

| Command | What it does |
| --- | --- |
| `/gtm-studio:doctor` | Checks Node, Playwright and the browser, and shows where `marketing/` stands. |
| `/gtm-studio:brand` | Reads the project, asks you at most five questions in one message, writes `marketing/brand.md`. |
| `/gtm-studio:plan [YYYY-MM-DD]` | Builds the 4-week calendar (`calendar.md`, `calendar.json`, `calendar.html`). Starts next Monday, or on the Monday of the date you give. |
| `/gtm-studio:create [YYYY-MM-DD]` | Writes every pending post, or only the one on that date. Never overwrites a created post unless you ask. |

`brand.md` is the gate: `plan` and `create` refuse to run without it. Review it before planning; everything written later follows it.

## A full run

Say you built **Widgetly**, a Next.js app, and you want people to know it exists.

**1. Brand.** In the Widgetly repository:

```
/gtm-studio:brand
```

GTM Studio scans the repo: it finds the Next.js app and its `npm run dev`, the landing page copy, the pricing page, the default locale, the Tailwind colors and fonts, the logo files in `public/`. It reads the README and the landing components, then asks you, in one message:

> 1. Ideal customer. My guess: product managers at 10–50 person SaaS teams…
> 2. The problem. My guess: …
> 3. Alternatives. My guess: Notion tables and a weekly spreadsheet…
> 4. Goal for the next four weeks. My guess: free signups → https://widgetly.app
> 5. Tone. My guess: direct, warm, no hype…

You correct what is wrong, type `ok` for the rest, and it writes `marketing/brand.md`: one-line description, value proposition, audience, problem and concrete benefits, proof points pulled from the code, tone, five "say it like this" and five "never like this" phrases, forbidden words, and the visual tokens (colors, fonts, logo) in a small JSON block that the slide templates read.

**2. Plan.**

```
/gtm-studio:plan
```

You get `marketing/calendar.md`:

| Week | Date | Time | Format | Goal | Topic | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-10 (Tue) | 08:30 | Carousel | Problem awareness | Why your roadmap spreadsheet is lying to you | Pending |
| 1 | 2026-11-11 (Wed) | 08:30 | Text post | Show the product | One board, three audiences | Pending |
| 1 | 2026-11-12 (Thu) | 08:30 | Screenshot post | Build story | The feature we deleted after week one | Pending |
| … | | | | | | |

Topics and angles live in `calendar.json`; edit them if you like before the next step.

**3. Create.**

```
/gtm-studio:create
```

GTM Studio asks how to capture screenshots: start the app with `npm run dev` and capture the home and pricing routes, use an app you already have running, capture the live site, or skip. Then it writes the posts. For each one you get a folder:

```
marketing/posts/2026-11-10-roadmap-spreadsheet-lying/
├── post.md          the text, ready to paste
├── slides.json      the slide content (what the writer decided)
├── slide-01.png …   one 1080x1350 PNG per slide
├── carousel.pdf     the document LinkedIn accepts for carousels
├── thumbs/          small previews for calendar.html
└── checklist.md     when to post, what to upload, hashtags, first comment, steps
```

Text posts have `post.md` and `checklist.md` only. Screenshot posts have one `slide-01.png` with your real screen inside a browser or phone frame.

**4. Publish, by hand.** Open `marketing/calendar.html` in your browser. Click a post, copy the text, open the images or the PDF, follow the checklist. Reply to comments during the first hour; the checklist reminds you.

Run `/gtm-studio:create 2026-11-10` to redo a single post after editing its angle, and confirm when it asks to overwrite.

## What gets generated, and where

Everything lands in `marketing/` at the root of your project. Nothing else in your repository is touched.

| File | Purpose |
| --- | --- |
| `marketing/brand.md` | The brand guide. Human-readable, with one JSON tokens block the scripts parse. |
| `marketing/calendar.md` | The calendar as a table, in your product's language. |
| `marketing/calendar.json` | The calendar the plugin reads and updates (status per post). |
| `marketing/calendar.html` | Self-contained review page. Thumbnails embedded, full images and PDFs linked. |
| `marketing/screens/` | Screenshots captured from your app, plus `manifest.json`. Delete the folder to capture again. |
| `marketing/posts/<date>-<slug>/` | One folder per post. |

Content is written in the product's language (detected from i18n config, `<html lang>` or the README, and editable in `brand.md`). The plugin itself, its skills and this README are in English.

## How it is built

```
gtm-studio/
├── .claude-plugin/
│   ├── plugin.json          manifest
│   └── marketplace.json     lets this repo act as its own marketplace
├── skills/                  the four commands (brand, plan, create, doctor)
│   └── create/writing-rules.md   rules every writer follows
├── agents/
│   └── linkedin-writer.md   the LinkedIn copywriter subagent
├── networks/linkedin/
│   ├── network.json         cadence, formats, sizes, limits
│   ├── playbook.md          what works on LinkedIn, for planner and writer
│   └── templates/           base.css + cover, point, screenshot, cta slides
├── scripts/                 Node (ESM), Playwright is the only dependency
│   ├── scan-project.mjs     reads the product repo
│   ├── calendar.mjs         creates and updates the calendar
│   ├── capture-screens.mjs  starts the app and takes screenshots
│   ├── render-slides.mjs    slides.json → PNG, thumbnails, PDF
│   ├── build-calendar-html.mjs
│   ├── doctor.mjs
│   └── lib/                 brand tokens, browser fallback, templating, dates
└── test/                    node:test suite
```

Claude writes; scripts render. The writer agent produces `post.md`, `slides.json` and `checklist.md`. The scripts turn `slides.json` into images with Playwright, deterministically, using CSS variables from `brand.md`. Slides are large type on plenty of white space, with the brand's colors and fonts, and no stock images.

Screenshots: `scan-project.mjs` finds the app (monorepos included) and its dev command and port. `capture-screens.mjs` starts it, waits for the URL, captures desktop and mobile shots of the routes you chose, and stops the process tree. If the app cannot start, slides fall back to a typographic variant and the checklist says so.

Browser: the scripts try Playwright's Chromium, then Chrome, then Edge. If none is found they print the install command instead of a stack trace.

## Add a network

Everything specific to LinkedIn lives in two places: `agents/linkedin-writer.md` and `networks/linkedin/`. To add, say, X:

1. Copy `networks/linkedin/` to `networks/x/`. Adjust `network.json` (cadence, formats, image sizes, character limits), rewrite `playbook.md` for the network, and tune the templates' CSS if the aspect ratio changes.
2. Copy `agents/linkedin-writer.md` to `agents/x-writer.md` and rewrite the network-specific parts (structure, lengths, what to upload).
3. In the skills, make the network a parameter (today `plan` and `create` point at `networks/linkedin`).

The scripts take the network spec as an argument and do not know what LinkedIn is.

## Troubleshooting

- **`/gtm-studio:brand` is not found**: run `claude plugin list` to check the plugin is enabled, or `/reload-plugins` after `--plugin-dir`.
- **"No Chromium-based browser is available"**: run `npx playwright install chromium` inside the plugin folder (`/gtm-studio:doctor` prints the path), or install Chrome or Edge.
- **Screenshots fail**: read `marketing/screens/dev-server.log`. Apps that need a login or environment variables to start can be captured from the live site instead, or you can run the app yourself and tell `create` the URL.
- **brand.md tokens error**: the JSON block after `<!-- gtm-studio:tokens -->` must stay valid JSON. The doctor shows the parser's message.
- **Fonts look wrong in slides**: Google Fonts are fetched at render time; without network access the slides use system fonts. Set `"source": "system"` in the tokens block to always use local fonts.

## License

MIT. See [LICENSE](LICENSE).
