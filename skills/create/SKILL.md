---
name: create
description: Write the pending LinkedIn posts from marketing/calendar.json (or specific dates): text, carousel images and PDF, and a publishing checklist in marketing/posts/.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD[,YYYY-MM-DD]] [capture=local|live|running:<url>|skip]"
allowed-tools: Bash(node *) PowerShell(node *)
---

# /gtm-studio:create

You orchestrate the creation of posts. The writer agent `gtm-studio:linkedin-writer` writes each post's text, slide content and checklist; the plugin's scripts capture screenshots and render images; you coordinate, check and report. Nothing is published.

Arguments (`$ARGUMENTS`, space-separated, all optional):

- One or more dates, `YYYY-MM-DD`, comma-separated: create only those posts. Without dates, every pending post is created.
- `capture=local` (start the app and capture it), `capture=live` (capture the website from brand.md), `capture=running:<url>` (an app the user already runs) or `capture=skip`. Without it you ask, or default to `local` when you cannot ask.

Paths used below:

- Marketing folder: `${CLAUDE_PROJECT_DIR}/marketing`
- Network spec: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/network.json`
- Playbook: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/playbook.md`
- Templates reference: `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/templates/README.md`
- Writing rules: `${CLAUDE_PLUGIN_ROOT}/skills/create/writing-rules.md`

Language of this conversation: the language the user has been using; if the only input is the command itself, the content language from brand.md.

Do not read the plugin's scripts, templates or CSS: their JSON output and this file are all you need. Reading them costs money and changes nothing.

## 1. Check prerequisites

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --project-root "${CLAUDE_PROJECT_DIR}"
```

- No `marketing/brand.md` or a broken tokens block: stop, point to `/gtm-studio:brand`.
- No `marketing/calendar.json`: stop, point to `/gtm-studio:plan`.
- No browser available: images cannot be rendered. Offer to run `cd "${CLAUDE_PLUGIN_ROOT}" && npx playwright install chromium` now. If the user declines, continue only for text posts and say that carousel and screenshot posts were skipped.

Read `marketing/brand.md` once yourself: you need the content language, the time zone, the website, the CTA URL and link placement from section 9, the tokens `linkPlacement` and `timezone`, and the capturable screens from section 5.

## 2. Decide which posts to create

List the candidates:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.mjs" list --marketing "${CLAUDE_PROJECT_DIR}/marketing" --status pending
```

With dates, run `list --date YYYY-MM-DD` for each one instead:

- `pending`: create it.
- `created`: do not touch it unless the user explicitly asks to recreate it. Ask once: "This post was already created. Recreate it and overwrite its files?" Only a clear yes continues, and then the writer is called with `overwrite: true`.
- No post on that date: say so and show the dates that exist.

Without dates, if nothing is pending, say so and point to `marketing/calendar.html`. A pending post whose folder already has files from an interrupted run is simply created again.

## 3. Screenshots (once per run)

Needed when any target post's angle contains `capture:`. Angles with `manual capture:` are not captured by you; the writer puts instructions in the checklist. If `marketing/screens/manifest.json` already exists and contains every route and selector the targets need, reuse it and tell the user that deleting `marketing/screens` forces a new capture.

Otherwise:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scan-project.mjs" --root "${CLAUDE_PROJECT_DIR}"` and read `app` (dir, devCommand, port, portArg).
2. Collect the routes from the angles, as the capture script expects them: `home` for `/`, `pricing` for `/pricing`, and `route@selector` when the angle gives a selector (for example `home@#how-it-works`). Add `home` if it is missing.
3. Decide how to capture. If the user passed `capture=…`, use it. Otherwise ask with AskUserQuestion, options in this order: **Start the app locally** (recommended when the scan found a dev command: "I will run `<devCommand>` in `<dir>`, wait for it, capture <routes> on desktop and mobile, then stop it; the app must start without manual login"), **It is already running** (ask for the URL), **Capture the live site** (the website from brand.md), **Skip screenshots**. If you cannot ask (no interactive user), use `local` when the scan found a dev command, else `live`, and say in the report that you chose it.
4. Run the capture:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture-screens.mjs" --url http://localhost:<port> --out "${CLAUDE_PROJECT_DIR}/marketing/screens" --routes <routes> --devices desktop,mobile --locale <content language> --start "<devCommand>" --cwd "${CLAUDE_PROJECT_DIR}/<dir>" --expect "<product name from brand.md>" --port-arg <app.portArg>
```

`--expect` matters: if the port is already taken by another project of the user, the script notices that the page does not mention the product, starts the app on a free port instead, and says so in `warnings`. Omit `--port-arg` when the scan gives `null`. For `running:<url>` and `live`, pass that URL and omit `--start`, `--cwd`, `--expect` and `--port-arg`. For `skip`, do not run it.

If the command fails or captures nothing, say what happened in one or two lines (the dev server log is in `marketing/screens/dev-server.log`), continue without screenshots and make sure the checklists mention the missing captures. Never write your own capture script; a screen the script cannot take is a manual capture.

Read `manifest.json` afterwards: `url` is where the screens really came from, `screens[].file` are the file names (the writer references them as `screens/<file>`), and `warnings` go into your final report.

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
  "linkPlacement": "first-comment" or "body",
  "timezone": "<from brand.md tokens, or null>",
  "overwrite": false
}
```

Use absolute paths. Run up to three writers in parallel. When a writer reports that it dropped a fact, found no screenshot or left a manual capture, keep that note for the final report.

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

Before reporting, read each `post.md`, `slides.json` and `checklist.md` you created and check:

- Lines 1 and 2 of `post.md` are the hook and fit in 210 characters; line 3 is blank.
- The link is where brand.md says: `first-comment` means no URL in `post.md` and the full link in the checklist's first comment; `body` means the URL closes the post text. Do not reinterpret this.
- No word from brand.md section 8 and none of the forbidden fillers from the writing rules. Search for them.
- Every number or claim is in brand.md. If one is not, edit the sentence to remove it and note it in the report.
- The same numbers, names and labels appear in all three files (a "38" on the cover cannot be a "39" in the text or the checklist).
- Hashtags: 3 to 5, last line.
- The checklist states the date, the time and the time zone.

Fix small problems directly, in all three files. Send a post back to a writer only when the structure is wrong.

## 7. Report

Tell the user, briefly:

- A table of the posts created: date, format, folder, files (post.md, slide count, carousel.pdf, checklist.md).
- Warnings: capture mode chosen for them, fallbacks used, manual captures pending, facts removed, render warnings.
- What to do next: open `marketing/calendar.html` to review each post with its images and checklist, or read `marketing/posts/<folder>/checklist.md`. Remind them that nothing has been published.
