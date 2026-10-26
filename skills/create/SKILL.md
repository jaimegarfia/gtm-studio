---
name: create
description: Write the pending LinkedIn posts from marketing/calendar.json (or one post for a given date): text, carousel images and PDF, and a publishing checklist in marketing/posts/.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD]"
allowed-tools: Bash(node *)
---

# /gtm-studio:create

You orchestrate the creation of posts. The writer agent `gtm-studio:linkedin-writer` writes each post's text, slide content and checklist; the plugin's scripts capture screenshots and render images; you coordinate, check and report. Nothing is published.

Optional argument: a date (`$ARGUMENTS`, `YYYY-MM-DD`) to create only that post. Without it, every pending post is created.

Paths used below:

- Marketing folder: `${CLAUDE_PROJECT_DIR}/marketing`
- Network spec: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/network.json`
- Playbook: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/playbook.md`
- Templates reference: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/templates/README.md`
- Writing rules: `${CLAUDE_PLUGIN_ROOT}/skills/create/writing-rules.md`

## 1. Check prerequisites

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --project-root "${CLAUDE_PROJECT_DIR}"
```

- No `marketing/brand.md` or a broken tokens block: stop, point to `/gtm-studio:brand`.
- No `marketing/calendar.json`: stop, point to `/gtm-studio:plan`.
- No browser available: images cannot be rendered. Offer to run `cd "${CLAUDE_PLUGIN_ROOT}" && npx playwright install chromium` now. If the user declines, continue only for text posts and say that carousel and screenshot posts were skipped.

## 2. Decide which posts to create

List the candidates:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.mjs" list --marketing "${CLAUDE_PROJECT_DIR}/marketing" --status pending
```

With a date argument, use `--date YYYY-MM-DD` instead of `--status pending`:

- If that post is `pending`, create it.
- If it is already `created`, do not touch it unless the user explicitly asks to recreate it. Ask once: "This post was already created on <date>. Recreate it and overwrite its files?" Only a clear yes continues, and then the writer is called with `overwrite: true`.
- If there is no post on that date, say so and show the dates that exist.

Without a date, if nothing is pending, say so and point to `marketing/calendar.html`. A pending post whose folder already has files from an interrupted run is simply created again.

Read `marketing/brand.md` once yourself: you need the content language, the website and the CTA URL from section 9 for the writers and for your own checks.

## 3. Screenshots (once per run)

Needed when any target post has format `screenshot`, or a carousel angle mentions a screen. If `marketing/screens/manifest.json` already exists, reuse it and tell the user that deleting `marketing/screens` forces a new capture. Otherwise:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scan-project.mjs" --root "${CLAUDE_PROJECT_DIR}"` and read `app` (dir, devCommand, port).
2. Decide the routes: the home route plus every route or screen named in the target angles, plus the pricing route when the scan found one. Write them without a leading slash (`home,pricing,app`).
3. Ask the user, with AskUserQuestion, how to capture:
   - **Start the app locally** (recommended when the scan found a dev command): "I will run `<devCommand>` in `<dir>`, wait for `http://localhost:<port>`, capture <routes> on desktop and mobile, then stop it." Mention that the app must start without manual login for the screens to be useful.
   - **It is already running**: ask for the URL.
   - **Capture the live site** at the website from brand.md, when there is one.
   - **Skip screenshots**: slides use the text-only variant.
4. Run the capture:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture-screens.mjs" --url http://localhost:<port> --out "${CLAUDE_PROJECT_DIR}/marketing/screens" --routes <routes> --devices desktop,mobile --start "<devCommand>" --cwd "${CLAUDE_PROJECT_DIR}/<dir>" --expect "<product name from brand.md>" --port-arg <app.portArg>
```

`--expect` matters: if the port is already taken by another project of the user, the script notices that the page does not mention the product, starts the app on a free port instead, and says so in `warnings`. Omit `--port-arg` when the scan gives `null`. Omit `--start`, `--cwd`, `--expect` and `--port-arg` when the app is already running at a URL the user gave, or when capturing the live site. If the command fails or captures nothing, say what happened in one or two lines (the dev server log is in `marketing/screens/dev-server.log`), continue without screenshots and make sure the checklists mention the missing captures. Read `manifest.json` afterwards: its `url` is where the screens really came from, and its `warnings` go into your final report.

## 4. Write the posts

For each target post, dispatch the `gtm-studio:linkedin-writer` agent with a task message that contains, as a JSON block:

```json
{
  "brandPath": "<marketing>/brand.md",
  "entry": { …the calendar entry… },
  "postDir": "<marketing>/posts/<entry.id>",
  "networkPath": "<network.json>",
  "playbookPath": "<playbook.md>",
  "templatesReadmePath": "<templates README>",
  "writingRulesPath": "<writing-rules.md>",
  "screens": "<marketing>/screens/manifest.json" or "none",
  "otherTopics": ["…"],
  "website": "<from brand.md>",
  "ctaUrl": "<from brand.md section 9>",
  "overwrite": false
}
```

Use absolute paths. Run up to three writers in parallel. When a writer reports that it dropped a fact or found no screenshot, keep that note for the final report.

## 5. Render, mark and refresh

For each written post with format `carousel` or `screenshot`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/render-slides.mjs" --post "<postDir>"
```

Read the JSON it prints. If it fails because `slides.json` is invalid or uses a template or field wrongly, fix `slides.json` yourself (keep the writer's words) and run it again. Collect its `warnings`.

Then, for every post written successfully, in any format:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.mjs" set-status --marketing "<marketing>" --network "<network.json>" --id "<entry.id>" --status created
```

Finally, rebuild the calendar page once:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-calendar-html.mjs" --marketing "<marketing>"
```

## 6. Quality pass

Before reporting, read each `post.md` you created and check:

- Lines 1 and 2 are the hook and fit in 210 characters; line 3 is blank.
- No word from brand.md section 8 and none of the forbidden fillers from the writing rules. Search for them.
- Every number or claim is in brand.md. If one is not, edit the sentence to remove it and note it in the report.
- Hashtags: 3 to 5, last line.

Fix small problems directly. Send a post back to a writer only when the structure is wrong.

## 7. Report

Tell the user, briefly and in their language:

- A table of the posts created: date, format, folder, files (post.md, slide count, carousel.pdf, checklist.md).
- Warnings: fallbacks used, missing screenshots, facts removed, render warnings.
- What to do next: open `marketing/calendar.html` to review each post with its images and checklist, or read `marketing/posts/<folder>/checklist.md`. Remind them that nothing has been published.
