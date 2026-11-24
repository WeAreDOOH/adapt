# Adapt. — aspect ratio planner

Adapt. turns a list of screen sizes into the smallest set of artwork files that covers them all
without losing artwork fidelity, verifies the result, and exports it (spec, Excel, brief,
Photoshop templates, smart PSDs, an After Effects project builder, rendered sizes).
It is aimed at DOOH (digital out-of-home) planners, designers and artworkers.

| Path | What it is |
| --- | --- |
| `src/aspect-ratios.html` | The whole app: one self-contained HTML file (markup, CSS, JavaScript). No build step. |
| `tests/smoke_test.py` | 31 Playwright checks: planner numbers, views, sharing, artwork upload and every download. |
| `HANDOFF.md` | Full technical handoff: architecture, algorithms, UI map, exports, decisions, known issues, roadmap. |
| `AGENTS.md` | Short brief for an automated system or AI coding agent picking this up. |
| `experimental/aepx/` | Unfinished: writing After Effects `.aepx` projects directly. See HANDOFF.md. |
| `manifest.json` | File list with SHA-256 checksums, versions and where the live page is. |

## Run it

Open `src/aspect-ratios.html` in a browser, or run `npm run build` and serve `dist/`. Downloads use
the Claude capability when present and ordinary browser downloads when self-hosted.

## Test it

    pip install -r tests/requirements.txt && playwright install chromium
    npm install            # optional: lets the tests exercise the Excel, PSD and zip downloads
    python3 tests/smoke_test.py

Production URL: https://adapt.dooh.com
