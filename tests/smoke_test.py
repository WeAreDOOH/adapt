"""
Smoke tests for Adapt. (aspect-ratios.html).

Run:  pip install playwright && playwright install chromium
      python tests/smoke_test.py            # uses ../src/aspect-ratios.html
Each check prints PASS/FAIL; the script exits non-zero if any check fails.
Downloads are exercised through a mocked window.claude runtime. The Excel,
PSD and zip libraries are served from node_modules if present:
    npm i xlsx@0.18.5 ag-psd@31.0.2 jszip@3.10.1
"""
import os, sys, pathlib, struct, zlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "src" / "aspect-ratios.html").as_uri()
XLSX = ROOT / "node_modules" / "xlsx" / "dist" / "xlsx.full.min.js"
AGPSD = ROOT / "node_modules" / "ag-psd" / "dist" / "bundle.js"
JSZIP = ROOT / "node_modules" / "jszip" / "dist" / "jszip.min.js"
fails = 0

def check(name, cond, detail=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond: fails += 1

def png(w, h, rgb=(40, 90, 160)):
    """A minimal solid-colour PNG, for artwork upload checks."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def set_sizes(pg, text):
    """The sizes textarea is hidden behind the grid editor, so set it directly."""
    pg.evaluate("t => { const i = document.getElementById('input'); i.value = t; i.dispatchEvent(new Event('input')); }", text)

def toggle(pg, cid):
    pg.click(f"label.chk:has(#{cid})"); pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1300, "height": 900},
                        permissions=["clipboard-read", "clipboard-write"])
    pg = ctx.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.click("#example"); pg.wait_for_timeout(300)
    n = lambda: pg.inner_text("#stNeed")

    # Baseline numbers for the 31-size example list
    check("example: 31 sizes", pg.inner_text("#stSizes") == "31", pg.inner_text("#stSizes"))
    check("example: 15 ratios", pg.inner_text("#stRatios") == "15")
    check("default settings: 15 files", n() == "15", n())
    check("spec verified", pg.inner_text("#verdict").startswith("Verified"), pg.inner_text("#verdict"))

    toggle(pg, "allowDown"); check("downscaling off: 30 files", n() == "30", n()); toggle(pg, "allowDown")
    toggle(pg, "cropOn");    check("crop on: 12 files", n() == "12", n())
    toggle(pg, "floatOn");   check("crop + float: 9 files", n() == "9", n())
    toggle(pg, "cropOn");    check("float only: 9 files", n() == "9", n())
    check("still verified", pg.inner_text("#verdict").startswith("Verified"))

    # Reset
    pg.click("#resetSettings"); pg.wait_for_timeout(200)
    check("reset restores 15 files", n() == "15", n())
    check("reset button disabled at defaults", pg.is_disabled("#resetSettings"))

    # Skipped line reporting
    set_sizes(pg, pg.input_value("#input") + "\nbanner TBC"); pg.wait_for_timeout(200)
    check("skipped line flagged", "1 line skipped" in pg.inner_text("#checks"))
    check("verdict asks for attention", pg.inner_text("#verdict").startswith("Check"))

    check("grid shows one cell per line", pg.locator("#sizeGrid .szcell:not(.add)").count() == 32, pg.locator("#sizeGrid .szcell:not(.add)").count())
    check("unreadable line marked in the grid", pg.locator("#sizeGrid .szcell.bad").count() == 1)

    # Views and drill-down
    pg.click("#cardSizes"); check("sizes view opens", pg.is_visible("#paneSizes"))
    check("one card per line (32)", pg.locator("#readTable li").count() == 32, pg.locator("#readTable li").count())
    pg.click("#stFilesCard"); pg.locator("button.drill").first.click(); pg.wait_for_timeout(300)
    check("drill-down filters ratios", pg.is_visible("#filterBar") and pg.is_visible("#paneRatios"))

    # Share link round trip
    pg.click("#stFilesCard"); toggle(pg, "floatOn"); pg.click("#shareBtn"); pg.wait_for_timeout(300)
    link = pg.evaluate("navigator.clipboard.readText()")
    check("share link has #plan=", "#plan=" in link, link[:60])
    p2 = b.new_context().new_page(); p2.goto(link); p2.wait_for_timeout(700)
    check("shared link reopens plan", p2.is_checked("#floatOn") and p2.is_visible("#sharedNote"))

    # Artwork provisioning: drop files, they match by size
    pg.click("#cardArt")
    pg.set_input_files("#artInput", [{"name": "hero.png", "mimeType": "image/png", "buffer": png(3840, 2160)},
                                     {"name": "odd.png", "mimeType": "image/png", "buffer": png(1234, 777)}])
    pg.wait_for_timeout(800)
    check("artwork matched by size", pg.inner_text("#stArtSup").startswith("1 /"), pg.inner_text("#stArtSup"))
    check("unmatched artwork waits for a choice", pg.locator(".looseitem").count() == 1)
    check("previews drawn for every size of the file", pg.locator('canvas[data-f="3840×2160"]').count() >= 5)

    # Remembered settings
    pg.reload(); pg.wait_for_timeout(500)
    check("settings remembered after reload", pg.is_checked("#floatOn"))
    check("no page errors", not errors, "; ".join(errors))

    # Downloads with a mocked runtime
    ctx3 = b.new_context(); p3 = ctx3.new_page()
    if XLSX.exists():
        p3.route("https://cdnjs.cloudflare.com/**", lambda r: r.fulfill(path=str(XLSX), content_type="application/javascript"))
    if AGPSD.exists() and JSZIP.exists():
        p3.route("https://cdn.jsdelivr.net/npm/ag-psd@31.0.2/dist/bundle.js", lambda r: r.fulfill(path=str(AGPSD), content_type="application/javascript"))
        p3.route("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", lambda r: r.fulfill(path=str(JSZIP), content_type="application/javascript"))
    p3.add_init_script("""window.__saved=[];window.claude={use:async n=>n==='downloads'?{save:async ({filename,data})=>{window.__saved.push(filename);return {status:'saved'}}}:null}""")
    p3.goto(URL); p3.click("#example"); p3.wait_for_timeout(500)
    check("download buttons shown with runtime", p3.is_visible("#dlXlsx") and p3.is_visible("#dlBrief"))
    p3.click("#dlBrief"); p3.wait_for_timeout(300)
    if XLSX.exists(): p3.click("#dlXlsx"); p3.wait_for_timeout(1500)
    saved = p3.evaluate("window.__saved")
    check("brief saved", any(f.endswith(".html") for f in saved), saved)
    if XLSX.exists(): check("excel saved", any(f.endswith(".xlsx") for f in saved), saved)
    else: print("SKIP excel (npm i xlsx@0.18.5 to enable)")
    if AGPSD.exists() and JSZIP.exists():
        toggle(p3, "cropOn"); p3.click("#dlPsd"); p3.wait_for_timeout(6000)
        saved = p3.evaluate("window.__saved")
        check("psd templates saved as zip", any(f.startswith("artwork-templates") and f.endswith(".zip") for f in saved), saved)
        p3.click("#dlSmart"); p3.wait_for_timeout(15000)
        saved = p3.evaluate("window.__saved")
        check("smart psds saved as zip", any(f.startswith("smart-psds") and f.endswith(".zip") for f in saved), saved)
        p3.click("#dlAe"); p3.wait_for_timeout(3000)
        saved = p3.evaluate("window.__saved")
        check("after effects builder saved as zip", any(f.startswith("after-effects") and f.endswith(".zip") for f in saved), saved)
    else: print("SKIP psd templates (npm i ag-psd@31.0.2 jszip@3.10.1 to enable)")
    b.close()

print(f"\n{'All checks passed' if not fails else str(fails) + ' check(s) failed'}")
sys.exit(1 if fails else 0)
