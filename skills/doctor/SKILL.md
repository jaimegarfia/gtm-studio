---
name: doctor
description: Check that GTM Studio can run on this machine (Node, Playwright, browser) and show where the marketing/ folder stands.
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# /gtm-studio:doctor

Run the environment check and report the result to the user.

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --project-root "${CLAUDE_PROJECT_DIR}"
   ```

2. Show the output as-is, then explain in one or two sentences what to do next.
   The last two lines of the report (`Status:` and `Next step:`) already say it.

3. If a line starts with `✘` or `⚠`, run the fix it prints when it is safe and local
   (an `npm install` or `npx playwright install chromium` inside the plugin folder is fine).
   Ask before anything else. Run the doctor again afterwards to confirm.

Do not create or modify anything in the user's project from this command.
