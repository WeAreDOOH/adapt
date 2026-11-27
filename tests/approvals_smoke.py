"""Exercise the approval loop on an isolated Adapt server. Never point this at production."""
import os
import struct
import zlib

from playwright.sync_api import sync_playwright


def png(width, height, colour):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))

    rows = (b"\x00" + bytes(colour) * width) * height
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


base = os.environ["ADAPT_APPROVAL_TEST_URL"]
assert base.startswith("http://127.0.0.1:")
with sync_playwright() as driver:
    browser = driver.chromium.launch()
    owner = browser.new_page(viewport={"width": 1300, "height": 900})
    client = browser.new_page(viewport={"width": 1300, "height": 900})
    errors = []
    for page in (owner, client):
        page.on("pageerror", lambda error: errors.append(str(error)))
    owner.goto(base)
    owner.locator(".szadd").fill("640x360")
    owner.locator(".szadd").press("Enter")
    owner.locator(".szadd").fill("360x640")
    owner.locator(".szadd").press("Enter")
    assert owner.locator("#stNeed").inner_text() == "2"
    owner.locator("#saveBox summary").click()
    owner.locator("#planName").fill("Synthetic approval campaign")
    owner.locator("#savePlan").click()
    owner.wait_for_url("**/?saved=*")
    owner.locator("#cardArt").click()
    owner.set_input_files("#artInput", {"name": "landscape.png", "mimeType": "image/png",
                                        "buffer": png(640, 360, (20, 90, 180))})
    owner.locator("#artList .artfile.have").wait_for()
    owner.locator("#stageApprovals").click()
    owner.get_by_text("1 new size staged.", exact=False).wait_for()
    owner.locator("#openApprovals").click()
    owner.wait_for_url("**/approvals?plan=*")
    owner.get_by_text("1 of 2 sizes supplied", exact=False).wait_for()
    plan_id = owner.url.split("plan=")[1]
    assert client.request.get(base + "/api/approvals/plans/" + plan_id).status == 403
    assert client.request.get(base + "/api/approvals/review").status == 404
    owner.locator("#queue .card").filter(has_text="360 × 640").locator("input[type=file]").set_input_files(
        {"name": "portrait.png", "mimeType": "image/png", "buffer": png(360, 640, (40, 180, 90))})
    owner.get_by_text("2 of 2 sizes supplied", exact=False).wait_for()
    owner.get_by_role("checkbox", name="Include 360 × 640 in next review").uncheck()

    def submit_round():
        owner.locator("#flight").click()
        for name in ["checkSpec", "checkLayout", "checkScope"]:
            owner.locator("#" + name).check()
        owner.locator("#recipient").fill("client@example.test")
        owner.locator("#submitRound").click()
        owner.locator("#inviteDialog").wait_for()
        assert owner.locator("#emailInvite").get_attribute("href").startswith("mailto:")
        link = owner.locator("#inviteLink").input_value()
        owner.locator("#inviteDialog").get_by_role("button", name="Done").click()
        return link

    first_link = submit_round()
    client.goto(first_link)
    client.locator("#changes").wait_for()
    assert client.locator("#creativeList button").count() == 1
    assert client.locator("#creativeTitle").inner_text() == "640 × 360 px · Version 1"
    assert client.locator("#role").inner_text() == "Client reviewer"
    assert client.locator("#back").is_hidden()
    client.wait_for_function("document.querySelector('#artwork').naturalWidth === 640")
    client.locator("#rulers").click()
    client.locator("#grid").click()
    box = client.locator("#stage").bounding_box()
    x, y = box["x"], box["y"]
    client.mouse.move(x + 50, y - 10)
    client.mouse.down()
    client.mouse.move(x + 50, y + 42, steps=8)
    client.mouse.up()
    client.get_by_text("Horizontal guide", exact=False).wait_for()
    guide = client.locator("[data-guide]").first
    assert guide.count() == 1
    client.mouse.move(x + 60, y + 42)
    client.mouse.down()
    client.mouse.move(x + 60, y - 12, steps=6)
    client.mouse.up()
    assert client.locator("[data-guide]").count() == 0
    client.get_by_role("button", name="Pin note").click()
    client.mouse.click(x + 75, y + 75)
    client.locator("#noteText").fill("Raise the headline into the safe area.")
    client.get_by_role("button", name="Save note").click()
    client.get_by_role("button", name="Draw", exact=True).click()
    client.mouse.move(x + 110, y + 90)
    client.mouse.down()
    client.mouse.move(x + 160, y + 115, steps=8)
    client.mouse.up()
    client.get_by_role("button", name="Add note").click()
    client.locator("#noteText").fill("Retouch here.")
    client.get_by_role("button", name="Save note").click()
    client.locator("#changes").click()
    client.get_by_text("Review complete. Your decisions have been saved.").wait_for()
    owner.locator("#refresh").click()
    owner.get_by_role("button", name="Open amendments").click()
    owner.get_by_text("Raise the headline into the safe area.").wait_for()
    owner.get_by_text("Retouch here.").wait_for()
    owner.locator("#backWorkspace").click()
    owner.locator("#queue .card").filter(has_text="640 × 360").locator("input[type=file]").set_input_files(
        {"name": "landscape-amended.png", "mimeType": "image/png", "buffer": png(640, 360, (130, 90, 220))})
    owner.get_by_text("Version history (2)").wait_for()
    next_link = submit_round()
    client.goto(next_link)
    client.get_by_text("640 × 360 px · Version 2", exact=True).wait_for()
    client.locator("#approve").click()
    client.get_by_text("Review complete. Your decisions have been saved.").wait_for()
    client.goto(first_link)
    client.get_by_text("640 × 360 px · Version 1", exact=True).wait_for()
    client.get_by_text("Retouch here.", exact=True).wait_for()

    owner.locator("#refresh").click()
    owner.get_by_text("Round 1 · Complete", exact=True).wait_for()
    owner.on("dialog", lambda dialog: dialog.accept())
    owner.locator("#rounds .card").filter(has_text="Round 1").get_by_role("button", name="Revoke link").click()
    owner.get_by_text("Round 1 · Revoked", exact=True).wait_for()
    client.reload()
    client.get_by_text("Review unavailable", exact=True).wait_for()
    assert not errors, errors
    browser.close()
    print("PASS approval loop: scoped artwork, guides, markup, amends, new versions, decision and revocation")
