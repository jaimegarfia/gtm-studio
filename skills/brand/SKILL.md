---
name: brand
description: Define the product's brand voice and visual identity from its codebase and write marketing/brand.md. Every other GTM Studio command needs this file.
disable-model-invocation: true
allowed-tools: Bash(node *) PowerShell(node *)
---

# /gtm-studio:brand

You are creating `marketing/brand.md` for the product in the current project. The file is the single source of truth for everything GTM Studio writes later: voice, audience, facts, forbidden words and visual tokens. Spend effort here; it pays off in every post.

GTM Studio never publishes anything. This command only reads the project and writes one file. Do not offer to commit, push or publish anything.

Language of this conversation: answer in the language the user has been using. If the only input so far is the command itself, use the product's content language once you have detected it.

Do not read the plugin's own scripts or templates; run the scripts and use their output.

## 1. Check the environment (warn only)

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --project-root "${CLAUDE_PROJECT_DIR}"
```

- If Node is older than 20 or Playwright is missing, tell the user the fix and stop.
- If only the browser is missing, mention it in one line (it is needed by `/gtm-studio:create`, not now) and continue.
- If `marketing/brand.md` already exists, remember it: you will ask before overwriting in step 5.

## 2. Scan the project

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scan-project.mjs" --root "${CLAUDE_PROJECT_DIR}"
```

The JSON tells you where the app lives (`app`), the README and landing files (`readme`, `landing`), pricing files (`pricing`), i18n locales and the detected content `language`, design tokens (`design.colors`, `design.fonts`, `design.suggested`), logo candidates (`logos`), public URLs (`urls`) and product name candidates (`productNames`).

Paths are relative to the project root. Treat them as hints, not truth.

## 3. Read what the code says

Read, in this order, and stop when you can describe the product confidently:

1. The README (skip it if it is a framework placeholder).
2. The landing page files, top of the list first. Collect the headline, subheadline, feature names, numbers, testimonials and calls to action.
3. For the detected language, the i18n messages file (only the home, landing, pricing and onboarding namespaces; do not read legal texts).
4. Pricing files: plans, prices, limits, free tier.
5. Any `docs/` or marketing material already in the repo that describes the product, including who already publishes on which channel (bots, playbooks, kits).

Never read `node_modules`, build output or lock files. Keep notes of concrete facts: exact feature names, prices, limits, integrations, numbers. Writers can only use what ends up in brand.md.

From the design data, pick the palette:
- `primary` is the color of the main action button; when `design.suggested.primary` is a decorative accent, check the main button component and prefer its background. `accent` is the highlight; `background` and `surface` the page and card colors; `text` and `muted` the two text colors.
- If `design.suggested` is incomplete, choose from `design.colors` by name and value. Keep the product's real colors; do not invent a palette when one exists.
- Fonts: the heading and body families from `design.fonts`; `source` is `google` when they came from Google Fonts or next/font, otherwise `system`.
- Logo: prefer a wordmark SVG, then a logo SVG, then a PNG. `inversePath` is the version for dark backgrounds, `markPath` the icon-only version. Paths relative to the project root. If nothing fits, leave `null`.

If the code has no usable palette or fonts, use a sober default (dark text on white, one accent) and say so in section 11.

Also list the public screens worth showing in posts: routes that render without login or uploads, each with an optional CSS selector for the section that matters (a hero, a demo block, a pricing table). Anything that needs an account, an upload or a click is a "manual capture".

## 4. Ask the user (one message, at most five questions)

Before asking, draft your best guess for each answer from what you read. Then send one message with these five numbered questions. Under each, write "My guess: …" (in the conversation language) with your draft. Say that they can answer only what is wrong or missing, and that "ok" accepts every guess.

1. **Ideal customer.** Who exactly, in what situation, where do they hang out, and in which time zone do most of them live?
2. **The problem.** What are they trying to do when it goes wrong, and what does it cost them?
3. **Alternatives.** What do they use today instead (tools, manual process, nothing), and why should they switch?
4. **Goal for the next four weeks.** Signups, waitlist, demos, feedback, sales, hiring… the URL the posts should point to, and whether the link goes in the first comment (recommended on LinkedIn: links in the body lower reach) or at the end of the post text.
5. **Tone.** Three adjectives, and a brand or person whose writing they admire. Anything that must never appear.

Also state in one line the detected content language (for example `es`) and that posts will be written in it unless they say otherwise.

Then stop and wait for the reply. Do not write the file before the user answers. If you are running without a user who can answer (a headless session), say so, keep your guesses, and continue.

## 5. Write marketing/brand.md

- If `marketing/brand.md` already exists, ask whether to overwrite it. If the answer is no, stop and tell them the file was kept.
- Create the `marketing/` folder if needed. Do not touch anything else in it.
- Follow the structure of `${CLAUDE_SKILL_DIR}/brand-template.md` exactly: the same eleven numbered sections in the same order, then the tokens block. Translate the headings and write all content in the product's content language. Replace every placeholder; leave no template instructions in the file.
- Section 5 (proof points) must list only facts you found in the code or that the user gave you. Label every example as a real customer or as a fictional persona / demo data, and keep the same label wherever that example appears (sections 4, 7, 9). List the capturable screens (route + optional selector) and the manual-capture ones separately.
- Section 7: five "say it like this" phrases and five "never like this" phrases, written for this product, in its language. The bad examples should be the tempting mistakes for this product, not generic ones. The good examples contain no number, price or claim that section 5 does not state.
- Section 8: keep the generic AI phrases, and add the user's own forbidden words and anything in the tone answer.
- Section 9: the goal, the CTA, the exact URL, where the link goes, and who already publishes on which channel.
- The tokens block: an HTML comment `<!-- gtm-studio:tokens -->` followed immediately by a ```json fenced block with `product`, `language`, `website`, `timezone` (IANA name such as `Europe/Madrid` or `America/Mexico_City`, from question 1), `linkPlacement` (`first-comment` or `body`, from question 4), `colors` (all seven keys, hex or any valid CSS color), `fonts` (`heading`, `body`, `source`) and `logo` (`path`, `inversePath`, `markPath`; paths relative to the project root or `null`). Valid JSON, no comments, no trailing commas.

Before saving, re-read the file once for consistency: the same numbers everywhere, the same real/fictional labels, no phrase in section 7 that contradicts section 5.

Validate the file by running the doctor again. It must report `marketing/brand.md` with the product name and language.

## 6. Finish

Tell the user, briefly:

- Where the file is.
- The three things worth reviewing first: the tokens block (colors, fonts, logo, time zone, link placement), the forbidden words, and the proof points.
- That the next command is `/gtm-studio:plan`, and that it refuses to run until brand.md exists.

Do not offer to commit or push.
