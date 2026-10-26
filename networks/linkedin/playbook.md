# LinkedIn playbook

What works on LinkedIn for a developer launching a product, and the rules GTM Studio follows when planning and writing for it. The planner (`/gtm-studio:plan`) and the writer agent (`gtm-studio:linkedin-writer`) both read this file.

## How the feed treats a post

- Only the first two lines (about 210 characters) show before "…see more". They decide whether anyone reads on. Lead with the problem, a concrete number, a specific scene or a surprising statement. Never with the product name, a greeting or "I'm excited to announce".
- Dwell time matters more than likes. Carousels (uploaded as a PDF document) and posts that make people stop and read rank well. Links in the post body lower reach: put the link in the first comment and say so in the post ("link in the first comment").
- Posts with a real screenshot of the product outperform stock images. Stock images and generic AI art hurt.
- 3 to 5 hashtags at the end, specific ones (the niche, the role, the problem), not generic ones like #motivation.
- Text posts: 900 to 1,800 characters is the sweet spot. Short lines, one idea per line, white space. No walls of text.
- Best windows for a B2B or prosumer audience: Tuesday to Thursday, morning in the audience's time zone. The calendar uses that.
- Engage in the first hour: reply to every comment. The checklist reminds the user.

## Formats GTM Studio produces

| Format | What the user uploads | Notes |
| --- | --- | --- |
| `carousel` | `carousel.pdf` as a Document, plus the post text | 5 to 9 slides, 1080x1350, one idea per slide, big type. Slide 1 is the hook, last slide is the call to action. |
| `text` | The post text only | The hook does all the work. Use line breaks generously. |
| `screenshot` | `slide-01.png` as an image, plus the post text | One real screen of the product inside a browser or phone frame, with one line of caption on the image. |

## Goals and what each post must do

- `problem`: make the reader recognise a situation they have lived. Do not mention the product until the last third, or not at all.
- `product`: show one feature doing one job, with the real screen or a concrete before/after. One feature per post.
- `story`: how it got built: a decision, a mistake, a number, what changed. Honest and specific. These build trust over weeks.
- `cta`: ask for one thing (try it, join the waitlist, reply with X). Say exactly what happens when they click.

## Planning a 4-week calendar

- Week 1 opens the problem and introduces the product once. Week 4 closes with the strongest proof and a clear ask.
- Alternate formats so that two carousels are never on consecutive days. Spread the `cta` posts: one per week at most, never on the first day.
- Each topic is one specific idea, not a theme. "Why recruiters skip CVs with two columns" is a topic; "CV tips" is not.
- The `angle` is a one-line brief for the writer: the hook idea, the proof to use, and the ask.
- Reuse proof points from brand.md. If a topic has no proof point behind it, pick another topic.

## Writing rules specific to LinkedIn

- Write in the product's content language, in the first person of the brand (founder voice "I" or team voice "we", as brand.md says).
- Hook in lines 1 and 2. Line 3 is blank.
- No "I'm thrilled", no "game-changer", no rocket emojis, no emoji bullet lists, no "Agree?" bait. Questions are fine when they are real.
- End with a line that makes the next action obvious, then the hashtags on their own line.
- The first comment carries the link and one sentence of context.
