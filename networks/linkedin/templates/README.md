# LinkedIn slide templates

HTML fragments rendered by `scripts/render-slides.mjs` into 1080x1350 PNGs and a PDF. The renderer wraps each fragment in a document that already contains `base.css`, the brand variables from `brand.md` and, when the brand uses Google Fonts, the font link.

Every template receives these fields from the renderer, on top of the slide's own fields:

| Field | Meaning |
| --- | --- |
| `product`, `website` | From brand.md tokens (website without protocol). |
| `logo` | Data URI of the logo that fits the slide background (inverse logo on `inverted` slides when the brand has one), or empty. |
| `page`, `total` | 1-based slide number and slide count. |
| `pageClass` | `page` plus `last` on the final slide (PDF page breaks). |
| `titleSize` | `""`, `small` or `xsmall`, chosen from the title length so long titles still fit. |

A slide in `slides.json` is `{ "template": "<name>", ...fields }`. Templates and their fields:

## `cover` (first slide of a carousel)

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | The hook. 4 to 12 words. |
| `subtitle` | no | One supporting line. |
| `kicker` | no | Small uppercase label above the title. |
| `swipeLabel` | no | Text next to the arrow, e.g. "Desliza". |

## `point` (one idea per slide)

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | The idea, 3 to 10 words. |
| `number` | no | "01", "02"… |
| `kicker` | no | Small label. |
| `body` | no | One or two sentences, 44px. Max ~220 characters. |
| `bullets` | no | Array of 2 to 4 short strings. Use `body` or `bullets`, not both. |
| `quote` | no | A pulled quote or a number worth a slide of its own. |

## `screenshot` (a real screen of the product)

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | What the reader is looking at. |
| `image` | yes | Path to a PNG, relative to the post folder, the marketing folder or the project root. Usually `screens/<route>-<device>.png`. |
| `frame` | no | `browser` (default) or `phone`. |
| `caption` | no | One line under the frame. |
| `fallbackBody` | no | Shown instead of the image when the file is missing. The renderer adds a warning in that case. |
| `kicker` | no | Small label. |

## `cta` (last slide)

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | The ask, as a benefit. |
| `body` | no | What happens when they act. |
| `url` | no | Short URL to show, e.g. `cvora.net`. |
| `button` | no | Button-like label, e.g. "Pruébalo gratis". |
| `kicker` | no | Small label. |

## Adding a template

Create `<name>.html` here, use the shared classes from `base.css` (`.slide`, `.title`, `.body`, `.bullets`, `.footer`…), and document its fields above. The writer agent reads this file to know what it can use.

## Adding a network

Copy this folder to `networks/<network>/templates/`, adjust `network.json` (image sizes, slide counts) and the CSS sizes if the aspect ratio changes. The renderer takes the size from `network.json`, not from the CSS.
