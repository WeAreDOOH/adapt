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

Open **Creative** and save a named plan. Drop exact-size PNG, JPEG or WebP delivery
files to save originals against their sizes. Reopen Creative to see previews,
download originals, view markup and find every version. The optional master
preview tools use the planner's scaling rules to generate and save missing delivery
sizes. The flight check lists selected versions and omissions for each batch.
Drop onto a particular size to upload to that box, then add an optional note on
the draft. Notes accompany the specific version submitted in the round.

In an open reviewer round, **Markup** gives you freehand pen and marker tools,
arrows, boxes, circles and ellipses. Pick a colour and thickness, draw on the
canvas, then click the badge next to the mark to attach a note. The artworker
can open that badge on the submitted version. The drawing layer and its
notes are saved separately from the original image.

**People & roles** lets the plan owner add and revoke artworkers and reviewers.
Artworkers enter through a project access link and can upload, annotate the
submission with notes and submit to an active reviewer. They cannot grant access
or change plan sizes. Reviewers receive a separate, round-specific link.

Use **Creative → Start a practice review** to create a separate plan with sample
artwork. Submit it, then choose **Try as reviewer** to open the review view in
another tab. Practice rounds use the same review controls and skip the email draft.

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
