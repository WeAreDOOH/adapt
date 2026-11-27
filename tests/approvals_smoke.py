"""Exercise the approval loop on an isolated Adapt server. Never point this at production."""
import json
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
    owner.locator("#cardArt").click()
    owner.locator("#creativePlanName").fill("Synthetic approval campaign")
    owner.locator("#creativeSave").click()
    owner.wait_for_url("**/?saved=*&view=creative")
    original = png(640, 360, (20, 90, 180))
    owner.locator("#deliveryInput").set_input_files(
        {"name": "landscape.png", "mimeType": "image/png", "buffer": original})
    owner.get_by_text("1 image saved to this plan.", exact=True).wait_for()
    owner.get_by_text("1 of 2 sizes supplied", exact=False).wait_for()
    owner.reload()
    owner.get_by_text("1 of 2 sizes supplied", exact=False).wait_for()
    owner.get_by_role("button", name="Preview 640 × 360 version 1").click()
    owner.locator("#downloadVersion").wait_for()
    with owner.expect_download() as download:
        owner.locator("#downloadVersion").click()
    assert download.value.path().read_bytes() == original
    owner.locator("#backWorkspace").click()
    original_sizes = owner.locator("#input").input_value()
    owner.evaluate("""sizes => {
        const input = document.getElementById('input');
        input.value = sizes;
        input.dispatchEvent(new Event('input'));
    }""", original_sizes + "\n800x600")
    assert owner.locator("#creativeHost").is_hidden()
    assert owner.locator("#stArtSup").inner_text() == "—"
    owner.evaluate("""sizes => {
        const input = document.getElementById('input');
        input.value = sizes;
        input.dispatchEvent(new Event('input'));
    }""", original_sizes)
    owner.get_by_text("1 of 2 sizes supplied", exact=False).wait_for()

    plan_id = owner.url.split("saved=")[1].split("&")[0]
    assert client.request.get(base + "/api/approvals/plans/" + plan_id).status == 403
    assert client.request.get(base + "/api/approvals/review").status == 404
    roles = owner.locator("#membersDialog")
    owner.locator("#membersOpen").click()
    owner.locator("#memberEmail").fill("artist@example.test")
    owner.locator("#addMember").click()
    owner.locator("#memberLink").wait_for()
    artist_url = owner.locator("#memberLink").input_value()
    owner.locator("#memberEmail").fill("client@example.test")
    owner.locator("#memberRole").select_option("reviewer")
    owner.locator("#addMember").click()
    roles.get_by_text("client@example.test", exact=True).wait_for()
    roles.get_by_role("button", name="Done").click()
    artist = browser.new_page()
    artist.goto(artist_url)
    artist.get_by_text("1 of 2 sizes supplied", exact=False).wait_for()
    assert artist.locator("#membersOpen").is_hidden()
    artist_key = artist_url.split("#access=")[1]
    artist_headers = {"X-Adapt-Workspace-Key": artist_key}
    path = base + "/api/approvals/plans/" + plan_id
    assert artist.request.get(path + "/members", headers=artist_headers).status == 403
    assert artist.request.put(path + "/formats", headers=artist_headers, data={"formats": []}).status == 403
    artist.get_by_role("button", name="Add note").click()
    artist.locator("#creativeNoteInput").fill("Please check the revised legal line.")
    artist.locator("#saveCreativeNote").click()
    artist.get_by_text("Note: Please check the revised legal line.", exact=True).wait_for()
    portrait = owner.evaluate_handle("""bytes => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], 'portrait.png', { type: 'image/png' }));
        return data;
    }""", list(png(360, 640, (40, 180, 90))))
    owner.locator("#queue .card").filter(has_text="360 × 640").dispatch_event("drop", {"dataTransfer": portrait})
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
    assert client.locator("#role").inner_text() == "Reviewer"
    client.get_by_text("Please check the revised legal line.", exact=True).wait_for()
    assert client.locator("#back").is_hidden()
    client.wait_for_function("document.querySelector('#artwork').naturalWidth === 640")
    assert client.locator("#drawingTools").is_hidden()
    client.locator("#markupTools").click()
    assert client.locator("#drawingTools").is_visible()
    assert client.locator("#rulerX").is_visible()
    client.locator("#grid").click()
    box = client.locator("#stage").bounding_box()
    x, y = box["x"], box["y"]
    client.mouse.move(x + 50, y - 10)
    client.mouse.down()
    client.mouse.move(x + 50, y + 42, steps=8)
    client.mouse.up()
    client.locator("#feedbackList").get_by_text("Horizontal guide", exact=False).wait_for()
    guide = client.locator("[data-guide]").first
    assert guide.count() == 1
    client.mouse.move(x + 60, y + 42)
    client.mouse.down()
    client.mouse.move(x + 60, y - 12, steps=6)
    client.mouse.up()
    assert client.locator("[data-guide]").count() == 0
    client.mouse.move(x - 10, y + 50)
    client.mouse.down()
    client.mouse.move(x + 65, y + 50, steps=8)
    client.mouse.up()
    client.locator("#feedbackList").get_by_text("Vertical guide", exact=False).wait_for()
    client.locator("#horizontalGuide").click()
    assert client.locator("[data-guide]").count() == 2
    client.locator("#undo").click()
    assert client.locator("[data-guide]").count() == 1
    # Close and reopen without discarding the ruler guide or current draft.
    client.locator("#markupTools").click()
    assert client.locator("#drawingTools").is_hidden()
    client.locator("#markupTools").click()
    assert client.locator("[data-guide]").count() == 1
    client.get_by_role("button", name="Pin note").click()
    client.mouse.click(x + 75, y + 75)
    client.locator("#noteText").fill("Raise the headline into the safe area.")
    client.get_by_role("button", name="Save note").click()
    client.get_by_role("button", name="Pen", exact=True).click()
    client.mouse.move(x + 110, y + 90)
    client.mouse.down()
    client.mouse.move(x + 160, y + 115, steps=8)
    client.mouse.up()
    client.get_by_role("button", name="Add note to Pen stroke 1", exact=True).click()
    client.locator("#noteText").fill("Retouch here.")
    client.get_by_role("button", name="Save note").click()
    client.get_by_role("button", name="Circle / ellipse", exact=True).click()
    client.get_by_role("button", name="Red", exact=True).click()
    client.locator("#brush").select_option("12")
    box = client.locator("#stage").bounding_box()
    x, y = box["x"], box["y"]
    client.keyboard.down("Shift")
    client.mouse.move(x + 190, y + 55)
    client.mouse.down()
    client.mouse.move(x + 276, y + 114, steps=8)
    client.mouse.up()
    client.keyboard.up("Shift")
    ellipse = client.locator("[data-stroke-kind=ellipse] ellipse")
    assert ellipse.get_attribute("stroke") == "#ea263f"
    assert ellipse.get_attribute("stroke-width") == "12"
    assert abs(float(ellipse.get_attribute("rx")) - float(ellipse.get_attribute("ry"))) < 1
    client.get_by_role("button", name="Add note to Circle / ellipse 2", exact=True).click()
    client.locator("#noteText").fill("Make sure the logo is the correct colour.")
    client.get_by_role("button", name="Save note").click()
    client.get_by_role("button", name="Edit note on Circle / ellipse 2", exact=True).click()
    assert client.locator("#noteText").input_value() == "Make sure the logo is the correct colour."
    client.locator("#closeNote").click()
    client.get_by_role("button", name="Marker", exact=True).click()
    client.get_by_role("button", name="Yellow", exact=True).click()
    client.locator("#brush").select_option("24")
    box = client.locator("#stage").bounding_box()
    client.mouse.move(box["x"] + 310, box["y"] + 170)
    client.mouse.down()
    client.mouse.move(box["x"] + 355, box["y"] + 186, steps=8)
    client.mouse.up()
    marker = client.locator("[data-stroke-kind=marker]")
    assert marker.get_attribute("opacity") == "0.45"
    client.get_by_role("button", name="Eraser").click()
    client.get_by_role("button", name="Erase Marker stroke 3", exact=True).click()
    assert marker.count() == 0
    client.locator("#undo").click()
    assert marker.count() == 1
    client.locator("#redo").click()
    assert marker.count() == 0
    client.locator("#undo").click()
    client.locator("#changes").click()
    client.get_by_text("Review complete. Your decisions have been saved.").wait_for()
    owner.locator("#refresh").click()
    owner.get_by_role("button", name="Open amendments").click()
    owner.get_by_text("Raise the headline into the safe area.").wait_for()
    owner.get_by_text("Retouch here.").wait_for()
    owner.get_by_role("button", name="Read note on Circle / ellipse 2", exact=True).click()
    assert owner.locator("#noteReadOnly").inner_text() == "Make sure the logo is the correct colour."
    owner.locator("#closeNote").click()
    assert owner.locator("[data-stroke-kind=ellipse] ellipse").get_attribute("stroke-width") == "12"
    assert owner.locator("[data-stroke-kind=marker]").count() == 1
    with owner.expect_download() as annotated_download:
        owner.locator("#downloadVersion").click()
    assert annotated_download.value.path().read_bytes() == original
    owner.locator("#markupTools").click()
    owner.locator("#markupAccess").wait_for()
    assert owner.locator("#drawingTools").is_hidden()
    assert owner.locator("[data-guide]").count() == 0
    box = owner.locator("#stage").bounding_box()
    owner.mouse.move(box["x"] + 50, box["y"] - 10)
    owner.mouse.down()
    owner.mouse.move(box["x"] + 50, box["y"] + 42, steps=8)
    owner.mouse.up()
    owner.get_by_text("Temporary horizontal guide", exact=False).wait_for()
    assert owner.locator("[data-guide]").count() == 1
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
    owner.locator("#membersOpen").click()
    roles.locator(".card").filter(has_text="artist@example.test").get_by_role("button", name="Revoke access").click()
    roles.get_by_text("Artworker · Access revoked", exact=True).wait_for()
    assert artist.request.get(path, headers=artist_headers).status == 403
    roles.locator(".card").filter(has_text="client@example.test").get_by_role("button", name="Revoke access").click()
    roles.get_by_text("Reviewer · Access revoked", exact=True).wait_for()
    client.goto(next_link)
    client.get_by_text("Review unavailable", exact=True).wait_for()
    roles.get_by_role("button", name="Done").click()

    planner = browser.new_page(viewport={"width": 1300, "height": 900})
    draft_sizes = "\n".join(f"{800 + i}x600" for i in range(35))
    legacy = json.dumps({"v": 1, "sizes": "640x360\n320x480", "o": {"allowDown": 1}})
    planner.add_init_script(f"""(() => {{
        if (!localStorage.getItem('adapt-planner-draft-v2')) {{
            localStorage.setItem('ar-state', {json.dumps(legacy)});
            localStorage.setItem('ar-draft', {json.dumps(draft_sizes)});
        }}
    }})();""")
    planner.goto(base + "/?view=creative")
    assert planner.locator("#input").input_value() == draft_sizes
    with planner.context.expect_page() as new_tab:
        planner.locator("#startPractice").click()
    practice = new_tab.value
    practice.get_by_text("2 of 2 sizes supplied", exact=False).wait_for()
    assert practice.locator(".stats").is_hidden() and practice.locator("#startPractice").is_hidden()
    assert practice.locator("#exitPractice").is_visible()
    assert planner.locator("#input").input_value() == draft_sizes
    practice.locator("#flight").click()
    for name in ["checkSpec", "checkLayout", "checkScope"]:
        practice.locator("#" + name).check()
    assert practice.locator("#recipient").is_hidden()
    practice.locator("#submitRound").click()
    practice.locator("#tryReviewer").wait_for()
    assert practice.locator("#emailInvite").is_hidden()
    practice_link = practice.locator("#inviteLink").input_value()
    phone = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    touch_reviewer = phone.new_page()
    touch_reviewer.goto(practice_link)
    touch_reviewer.locator("#markupTools").click()
    touch_reviewer.locator("#stage").scroll_into_view_if_needed()
    phone_box = touch_reviewer.locator("#stage").bounding_box()
    touch = phone.new_cdp_session(touch_reviewer)
    start = {"x": phone_box["x"] + 40, "y": phone_box["y"] - 10}
    end = {"x": start["x"], "y": start["y"] + 65}
    touch.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [start]})
    touch.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [end]})
    touch.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    assert touch_reviewer.locator("[data-guide]").count() == 1
    phone.close()
    with practice.context.expect_page() as opened:
        practice.locator("#tryReviewer").click()
    practice_reviewer = opened.value
    practice_reviewer.get_by_text("Practice reviewer", exact=True).wait_for()
    practice_reviewer.locator("#markupTools").click()
    practice_reviewer.get_by_role("button", name="Pin note").wait_for()
    practice_reviewer.locator("#comment").fill("Move the headline up.")
    practice_reviewer.locator("#changes").click()
    practice_reviewer.get_by_text("Decision saved.", exact=True).wait_for()
    practice.locator("#inviteDialog").get_by_role("button", name="Done").click()
    practice.locator("#refresh").click()
    practice.get_by_role("button", name="Open amendments").wait_for()
    practice.locator("#exitPractice").click()
    practice.locator("#startPractice").wait_for()
    assert practice.locator("#input").input_value() == draft_sizes
    planner.reload()
    assert planner.locator("#input").input_value() == draft_sizes
    assert not errors, errors
    browser.close()
    print("PASS Creative: drawing tools, attached notes, original image bytes, guides and practice exit")
