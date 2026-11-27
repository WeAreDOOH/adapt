# Adapt. — aspect ratio planner

Adapt. turns a list of screen sizes into the smallest set of artwork files that covers them all
without losing artwork fidelity, verifies the result, and exports it (spec, Excel, brief,
Photoshop templates, smart PSDs, an After Effects project builder, rendered sizes).
It is aimed at DOOH (digital out-of-home) planners, designers and artworkers.

The planner also supports a review-first AI document import for PDF, Excel/CSV, Word,
PowerPoint and text files. It reports source locations, unit and width/height assumptions,
physical-size DPI equivalents and anomalies before the user chooses which digital sizes to
import. Named plans can be saved to the application database and shared through unlisted
view links; the creating browser keeps a separate edit key.

## Artwork approvals

Save a named plan, then open **Artwork supplied → Open approval queue**. Supply one
exact-size PNG, JPEG or WebP per size, or use **Stage supplied sizes** to provision
missing sizes using the planner's current artwork and scaling rules. The flight
check lists selected versions and omissions, so a queue can be submitted in batches.

Creating a round makes a review link and prepares an email draft for the artworker
to send. The link allows whoever receives it to see and review only that round's
artwork for 30 days. The artworker can revoke it from the queue. A reviewer can
approve each creative or request amends with canvas markup. Revisions are uploaded
as new versions, with the previous artwork and decisions still available in history.

| Path | What it is |
| --- | --- |
| `src/aspect-ratios.html` | The whole app: one self-contained HTML file (markup, CSS, JavaScript). No build step. |
| `tests/smoke_test.py` | Browser checks for planner numbers, document review, saved plans, views, sharing, artwork upload and every download. |
| `HANDOFF.md` | Full technical handoff: architecture, algorithms, UI map, exports, decisions, known issues, roadmap. |
| `AGENTS.md` | Short brief for an automated system or AI coding agent picking this up. |
| `experimental/aepx/` | Unfinished: writing After Effects `.aepx` projects directly. See HANDOFF.md. |
| `manifest.json` | File list with SHA-256 checksums, versions and where the live page is. |

## Run it

Open `src/aspect-ratios.html` in a browser, or run `npm run build` and serve `dist/`. Downloads use
the Claude capability when present and ordinary browser downloads when self-hosted.

For local AI review, put `OPENAI_API_KEY` in `.env.local`; `npm start` loads it without
placing the key in the built application or repository.

## Test it

    pip install -r tests/requirements.txt && playwright install chromium
    npm install            # optional: lets the tests exercise the Excel, PSD and zip downloads
    python3 tests/smoke_test.py

Production URL: https://adapt.dooh.com
