---
name: plan
description: Build a 4-week LinkedIn content calendar (3 posts per week) from marketing/brand.md and save it as marketing/calendar.md, marketing/calendar.json and marketing/calendar.html.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD]"
allowed-tools: Bash(node *) PowerShell(node *)
---

# /gtm-studio:plan

You are planning four weeks of LinkedIn content for the product described in `marketing/brand.md`. You decide the topics and angles; a script turns them into dated files.

Optional argument: the start date (`$ARGUMENTS`, format `YYYY-MM-DD`). The calendar always starts on a Monday; a later weekday is moved forward to the next Monday. Without an argument it starts next Monday.

Network for this version: LinkedIn. Its spec is `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/network.json` and its playbook is `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/playbook.md`.

Language of this conversation: the language the user has been using; if the only input is the command itself, the content language from brand.md. Do not read the plugin's scripts or templates; run the scripts and use their output.

## 1. Check prerequisites

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --project-root "${CLAUDE_PROJECT_DIR}"
```

- If `marketing/brand.md` is not found or its tokens block fails to parse, stop and tell the user to run `/gtm-studio:brand` (or fix the file).
- If `marketing/calendar.json` already exists, note how many posts are `created`. Ask the user whether to replace the calendar. Say that existing post folders stay on disk but will no longer be linked from the calendar. Only continue with a clear yes; then add `--force` in step 4.

## 2. Read the inputs

Read all of these, fully:

1. `marketing/brand.md`: audience, problem, proof points, capturable screens, goal, tone, forbidden words, content language, time zone.
2. `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/network.json`: cadence, formats, goals and the recommended `mix`.
3. `${CLAUDE_PLUGIN_ROOT}/networks/linkedin/playbook.md`: how to plan for this network.

## 3. Design the 12 slots

Write exactly `weeks x postsPerWeek` slots (12 for LinkedIn) as a JSON array. Each slot:

```json
{ "week": 1, "slot": 0, "format": "carousel", "goal": "problem", "topic": "…", "angle": "…", "slug": "why-recruiters-skip-two-column-cvs" }
```

- `week` 1..4, `slot` 0..2 (slot 0 is Tuesday, 1 Wednesday, 2 Thursday).
- `format`: `carousel`, `text` or `screenshot`. `goal`: `problem`, `product`, `story` or `cta`. Follow the `mix` counts in network.json as closely as possible; every format and every goal must appear at least once or the script rejects the slots.
- `topic`: one specific idea in the content language, 4 to 12 words, written as the reader would see it in the calendar.
- `angle`: a one-line brief for the writer, in the content language: the hook idea, the proof point from brand.md to use, and the ask (if any). The writer must be able to work from the angle alone.
- `slug`: kebab-case, ASCII, unique, 3 to 6 words.

Screens. A `screenshot` post, or a carousel that wants a product slide, names in its angle one capturable screen from brand.md section 5, as `capture: <route>` or `capture: <route> @ <css selector>` (for example `capture: / @ #how-it-works`). Only public routes that render without logging in, uploading anything or clicking through a flow. If the only screen that fits the idea needs that, write `manual capture: <what to show>` instead, and the writer will put instructions in the checklist; never promise a screen the capture script cannot take on its own.

Planning rules (from the playbook): week 1 opens with the problem and introduces the product once; week 4 ends with the strongest proof and a clear ask; no two carousels on consecutive days; at most one `cta` per week and never on a Tuesday of week 1; every topic rests on a proof point in brand.md; spread the examples and personas in brand.md so the same one does not carry two posts in a row.

Before writing the file, check the array yourself: 12 entries, unique week/slot pairs, unique slugs, counts close to the mix, every `capture:` pointing at a capturable screen.

## 4. Write the slots and build the calendar

Write the array to `marketing/.gtm-slots.json`, then run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/calendar.mjs" init --marketing "${CLAUDE_PROJECT_DIR}/marketing" --network "${CLAUDE_PLUGIN_ROOT}/networks/linkedin/network.json" --slots "${CLAUDE_PROJECT_DIR}/marketing/.gtm-slots.json" --start <YYYY-MM-DD>
```

Omit `--start` when the user gave no date. Add `--force` only after the user agreed to replace an existing calendar.

If the script rejects the slots, fix the array and run it again. Then delete `marketing/.gtm-slots.json`.

Build the calendar page so the user can already browse the plan:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-calendar-html.mjs" --marketing "${CLAUDE_PROJECT_DIR}/marketing"
```

## 5. Report

Show the user the table from `marketing/calendar.md` (read it; do not retype it from memory) and say:

- Where the files are: `marketing/calendar.md` for reading, `marketing/calendar.json` for the plugin, `marketing/calendar.html` to browse the plan in a browser (open it from disk).
- The time zone the times are in (from brand.md), or that brand.md has none and the times are local.
- That topics and angles can be edited in `calendar.json` before creating posts, and that `/gtm-studio:create` writes every pending post, or specific ones with `/gtm-studio:create YYYY-MM-DD`.
- If the start date was moved to a Monday, say so.
