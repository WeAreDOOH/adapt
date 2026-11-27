const $ = (name) => document.getElementById(name);
const planId = new URLSearchParams(location.search).get("plan");
const client = location.pathname === "/client-review";
const svgNS = "http://www.w3.org/2000/svg";
const statusNames = {
  empty: "Artwork needed", draft: "Ready to submit", in_review: "In review",
  approved: "Approved", changes: "Amendments requested",
};
const blankFeedback = () => ({ comment: "", notes: [], strokes: [], guides: [] });
const drafts = new Map();
const undoByCreative = new WeakMap();
const selected = new Set();
const markedVersions = new Set();
let workspace, review, current, feedback, pendingNote, gesture, imageUrl, generation = 0, navigationRequest = 0;
let position = 0, filter = "all", tool = "pan", zoom = 1, fit = true, busy = false;
let reviewKey = "";
let ownerKey = "";
const appKey = "adapt-review-key";

function make(tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function button(label, handler) {
  const element = make("button", label);
  element.type = "button";
  element.onclick = handler;
  return element;
}
function setNotice(id, message, error = false) {
  const node = $(id);
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle("error", error);
}
function prettySize(size) { return size.replace("x", " × "); }
function date(value) { return new Date(value).toLocaleString(); }
function badge(status) { return make("span", statusNames[status], "badge " + status); }
const ownerPath = "/api/approvals/plans/" + encodeURIComponent(planId ?? "");
const reviewPath = "/api/approvals/review";
async function api(url, options = {}) {
  const access = client ? { "X-Adapt-Review-Key": reviewKey } : { "X-Adapt-Plan-Key": ownerKey };
  const response = await fetch(url, { ...options, headers: { ...access, ...options.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Adapt could not complete this request (${response.status}).`);
  }
  return response;
}
async function post(url, body, method = "POST") {
  return (await api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
}
async function perform(action, control, errorId = "status") {
  if (busy) return;
  busy = true;
  if (control) control.disabled = true;
  setNotice(errorId, "");
  try { await action(); }
  catch (error) { setNotice(errorId, error.message, true); }
  finally {
    if (control) control.disabled = false;
    busy = false;
  }
}

async function loadWorkspace() {
  workspace = await (await api(ownerPath)).json();
  $("title").textContent = workspace.title;
  $("intro").textContent = "Supply one file per size, submit a review round and pick up amendments here.";
  const ready = new Set(workspace.formats.map((f) => f.versions[0]).filter((v) => v?.status === "draft").map((v) => v.id));
  for (const key of selected) if (!ready.has(key)) selected.delete(key);
  for (const key of ready) {
    if (!markedVersions.has(key)) selected.add(key);
    markedVersions.add(key);
  }
  renderWorkspace();
}

function renderWorkspace() {
  const formats = workspace.formats;
  const supplied = formats.filter((f) => f.versions.length).length;
  const amends = formats.filter((f) => f.versions[0]?.status === "changes").length;
  $("coverage").textContent = `${supplied} of ${formats.length} sizes supplied · ${selected.size} selected · ${amends} awaiting amends`;
  $("flight").disabled = !selected.size;
  const rows = formats.filter((f) => filter === "all" || f.versions[0]?.status === filter);
  $("queue").replaceChildren(...rows.map((row) => formatCard(row, false)));
  if (!rows.length) $("queue").append(make("p", formats.length ? "No artwork in this queue." : "Open Artwork supplied in the planner to add sizes."));
  $("archived").hidden = !workspace.archived.length;
  $("archiveList").replaceChildren(...workspace.archived.map((row) => formatCard(row, true)));
  $("rounds").replaceChildren(...workspace.rounds.map(roundCard));
  if (!workspace.rounds.length) $("rounds").append(make("p", "No review rounds submitted yet."));
}

function formatCard(row, archived) {
  const version = row.versions[0];
  const card = make("article", "", "card");
  const identity = make("div");
  identity.append(make("h3", prettySize(row.size) + " px"), badge(version?.status || "empty"));
  if (version) identity.append(make("p", `Version ${version.number} · ${version.filename}`));
  card.append(identity);
  if (version?.status === "draft" && !archived) {
    const label = make("label", "", "check");
    const check = make("input");
    check.type = "checkbox";
    check.checked = selected.has(version.id);
    check.onchange = () => {
      if (check.checked) selected.add(version.id);
      else selected.delete(version.id);
      $("flight").disabled = !selected.size;
      $("coverage").textContent = $("coverage").textContent.replace(/\d+ selected/, selected.size + " selected");
    };
    check.setAttribute("aria-label", "Include " + prettySize(row.size) + " in next review");
    label.append(check, "Include");
    card.append(label);
  }
  if (!archived && version?.status !== "in_review") {
    const upload = make("input");
    upload.type = "file";
    upload.accept = "image/png,image/jpeg,image/webp";
    upload.hidden = true;
    const uploadButton = button(version ? "Upload new version" : "Upload artwork", () => upload.click());
    upload.onchange = () => {
      const file = upload.files[0];
      if (!file) return;
      perform(async () => {
        await uploadArtwork(row.size, file);
        await loadWorkspace();
        setNotice("status", `Artwork saved for ${prettySize(row.size)}.`);
      }, uploadButton);
      upload.value = "";
    };
    card.append(uploadButton, upload);
  }
  if (version) {
    card.append(button(version.status === "changes" ? "Open amendments" : "View artwork", () => openOwnerVersion(row, version)));
    const history = make("details", "", "version-list");
    history.append(make("summary", `Version history (${row.versions.length})`));
    const list = make("ul");
    row.versions.forEach((entry) => {
      const li = make("li");
      li.append(button(`Version ${entry.number} · ${statusNames[entry.status]} · ${date(entry.created)}`, () => openOwnerVersion(row, entry)));
      list.append(li);
    });
    history.append(list);
    card.append(history);
  }
  return card;
}

async function uploadArtwork(size, file) {
  if (file.size > 20_000_000) throw new Error("Artwork must be under 20 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode().catch(() => { throw new Error("Adapt could not read this image."); });
    if (size !== `${image.naturalWidth}x${image.naturalHeight}`) {
      throw new Error(`Expected ${prettySize(size)} px. This file is ${image.naturalWidth} × ${image.naturalHeight} px.`);
    }
  } finally { URL.revokeObjectURL(url); }
  return api(ownerPath + "/artwork/" + size, {
    method: "POST", body: file,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
  });
}

function roundCard(round) {
  const card = make("article", "", "card");
  const label = make("div");
  const closed = round.revoked || round.expires <= new Date().toISOString();
  const state = round.revoked ? "Revoked" : closed ? "Expired" : round.completed ? "Complete" : "Open";
  label.append(make("h3", `Round ${round.number} · ${state}`), make("p", `${round.recipient} · ${round.decided} of ${round.total} reviewed · ${date(round.created)}`));
  card.append(label);
  if (!closed) {
    const link = getInvite(round.id);
    if (link) card.append(button("Review link", () => showInvite(link, round)));
    card.append(button("Revoke link", () => {
      if (!confirm("Revoke this link? Unreviewed artwork returns to the submission queue.")) return;
      perform(async () => { await api(ownerPath + "/rounds/" + round.id, { method: "DELETE" }); await loadWorkspace(); });
    }));
  }
  return card;
}
function getInvite(id) {
  try { return localStorage.getItem("adapt-invite-" + id); } catch { return null; }
}
function showInvite(link, round) {
  $("inviteLink").value = link;
  $("inviteInfo").textContent = `Round ${round.number} for ${round.recipient}. Anyone with this link can review this round until ${date(round.expires)}.`;
  const subject = `Artwork review · ${workspace.title} · round ${round.number}`;
  const message = round.message ? round.message + "\n\n" : "";
  const body = `Hello,\n\nPlease review the artwork for ${workspace.title}.\n\n${message}${link}\n\nYou can approve each size or mark up any changes in Adapt. Thank you.`;
  $("emailInvite").href = "mailto:" + encodeURIComponent(round.recipient) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  $("copyInvite").textContent = "Copy link";
  $("inviteDialog").showModal();
}

$("flight").onclick = () => {
  const list = workspace.formats.filter((f) => selected.has(f.versions[0]?.id));
  const omitted = workspace.formats.length - list.length;
  $("flightForm").reset();
  setNotice("flightError", "");
  $("recipient").value = workspace.rounds[0]?.recipient || "";
  $("flightSummary").textContent = `${list.length} size${list.length === 1 ? "" : "s"} in this round. ${omitted} outside this round, including sizes that are missing, unselected or already reviewed.`;
  $("flightList").replaceChildren(...list.map((f) => make("li", `${prettySize(f.size)} px · v${f.versions[0].number} · ${f.versions[0].filename}`)));
  $("flightDialog").showModal();
};
$("flightForm").onsubmit = (event) => {
  event.preventDefault();
  const recipient = $("recipient").value.trim();
  const message = $("message").value.trim();
  perform(async () => {
    const round = await post(ownerPath + "/rounds", {
      recipient, message, versions: [...selected],
      checks: { spec: $("checkSpec").checked, layout: $("checkLayout").checked, scope: $("checkScope").checked },
    });
    const link = location.origin + "/client-review#review=" + round.token;
    try { localStorage.setItem("adapt-invite-" + round.id, link); } catch {}
    $("flightDialog").close();
    showInvite(link, { ...round, recipient, message });
    await loadWorkspace();
  }, $("submitRound"), "flightError");
};
$("copyInvite").onclick = async () => {
  $("inviteLink").select();
  try {
    await navigator.clipboard.writeText($("inviteLink").value);
    $("copyInvite").textContent = "Copied";
  } catch { $("copyInvite").textContent = "Link selected"; }
};
$("refresh").onclick = () => perform(loadWorkspace, $("refresh"));
document.querySelectorAll("[data-close]").forEach((control) => { control.onclick = () => $(control.dataset.close).close(); });
document.querySelectorAll("[data-filter]").forEach((control) => {
  control.onclick = () => {
    filter = control.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", item === control));
    renderWorkspace();
    control.focus();
  };
});

function openOwnerVersion(row, version) {
  perform(async () => {
    const record = await (await api(ownerPath + "/versions/" + version.id)).json();
    const latestDecision = record.entries.find((entry) => entry.decision);
    $("history").replaceChildren(make("h3", "Version history"),
      ...row.versions.map((v) => button("v" + v.number, () => openOwnerVersion(row, v))));
    if (record.entries.length) {
      $("history").append(make("p", record.entries.map((entry) =>
        `Round ${entry.round}: ${entry.decision ? statusNames[entry.decision] : "submitted"}`).join(" · ")));
    }
    $("history").hidden = false;
    $("backWorkspace").hidden = false;
    await display({ ...record, decision: latestDecision?.decision, feedback: latestDecision?.feedback }, ownerPath + "/versions/" + version.id + "/image");
  });
}

async function openClientPosition(index) {
  if (!review || index < 0 || index >= review.items.length || busy) return;
  const request = ++navigationRequest;
  position = index;
  $("previous").disabled = position === 0;
  $("next").disabled = position === review.items.length - 1;
  $("position").textContent = `${position + 1} of ${review.items.length}`;
  const progress = review.items.filter((item) => item.decision).length;
  $("decisions").textContent = review.completed ? "Review complete" : `${progress} reviewed`;
  $("creativeList").replaceChildren(...review.items.map((item, i) => {
    const choice = button(prettySize(item.size) + (item.decision ? " · " + statusNames[item.decision] : ""), () => openClientPosition(i));
    if (i === position) choice.setAttribute("aria-current", "true");
    return choice;
  }));
  $("creativeList").querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const item = review.items[position];
  try {
    $("decisionControls").hidden = true;
    const saved = item.decision ? await (await api(reviewPath + "/" + item.id + "/feedback")).json() : {};
    if (request !== navigationRequest) return;
    await display({ ...item, ...saved }, reviewPath + "/" + item.id + "/image");
  }
  catch (error) { setNotice("status", error.message, true); }
}

async function display(item, imagePath) {
  current = item;
  gesture = null;
  feedback = item.feedback || drafts.get(item.id) || blankFeedback();
  if (editable()) drafts.set(item.id, feedback);
  setNotice("status", "");
  setNotice("decisionError", "");
  $("workspace").hidden = true;
  $("viewer").hidden = false;
  $("navigation").hidden = !client;
  $("creativeList").hidden = !client;
  $("creativeTitle").textContent = `${prettySize(item.size)} px · Version ${item.number}`;
  $("creativeFile").textContent = item.filename;
  $("decisionBadge").replaceChildren(item.decision ? badge(item.decision) : make("span", client ? "Awaiting review" : ""));
  $("decisionControls").hidden = !editable();
  $("changes").disabled = $("approve").disabled = true;
  $("drawingTools").hidden = !editable();
  $("comment").value = feedback.comment;
  $("viewport").scrollTo(0, 0);
  setTool("pan");
  fit = true;
  resize();
  draw();
  renderFeedback();
  const ticket = ++generation;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  $("artwork").removeAttribute("src");
  const blob = await (await api(imagePath)).blob();
  if (ticket !== generation) return;
  imageUrl = URL.createObjectURL(blob);
  $("artwork").src = imageUrl;
  $("artwork").alt = "Artwork for " + prettySize(item.size);
  await $("artwork").decode().catch(() => {
    if (ticket === generation) throw new Error("Adapt could not display this artwork image.");
  });
  if (ticket === generation) $("changes").disabled = $("approve").disabled = !editable();
}

function editable() { return client && current && !current.decision; }
function recordUndo(action) {
  const stack = undoByCreative.get(feedback) || [];
  stack.push(action);
  if (stack.length > 25) stack.shift();
  undoByCreative.set(feedback, stack);
}
$("backWorkspace").onclick = () => {
  generation++;
  $("viewer").hidden = true;
  $("workspace").hidden = false;
};
$("previous").onclick = () => openClientPosition(position - 1);
$("next").onclick = () => openClientPosition(position + 1);
$("comment").oninput = () => { if (editable()) feedback.comment = $("comment").value; };

function decide(decision, control) {
  if (!editable() || busy) return;
  const item = current;
  $("changes").disabled = $("approve").disabled = true;
  const payload = structuredClone(feedback);
  perform(async () => {
    review = await post(reviewPath + "/" + item.id + "/decision", { decision, feedback: payload });
    drafts.delete(item.id);
  }, control, "decisionError").then(() => {
    $("changes").disabled = $("approve").disabled = false;
    if (review.items[position]?.decision) {
      const next = review.items.findIndex((entry, i) => i > position && !entry.decision);
      const remaining = review.items.findIndex((entry) => !entry.decision);
      openClientPosition(next >= 0 ? next : remaining >= 0 ? remaining : position).then(() => {
        setNotice("status", review.completed ? "Review complete. Your decisions have been saved." : "Decision saved.");
      });
    }
  });
}
$("changes").onclick = () => decide("changes", $("changes"));
$("approve").onclick = () => decide("approved", $("approve"));

function toggle(id) {
  const next = $(id).getAttribute("aria-pressed") !== "true";
  $(id).setAttribute("aria-pressed", next);
  return next;
}
const on = (id) => $(id).getAttribute("aria-pressed") === "true";
const clamp = (n) => Math.max(0, Math.min(1, n));
const roundedPoint = (point) => point.map((n) => Math.round(clamp(n) * 10000) / 10000);
function resize() {
  if (!current || $("viewer").hidden) return;
  const [width, height] = current.size.split("x").map(Number);
  const viewport = $("viewport");
  if (fit) zoom = Math.min((viewport.clientWidth - 58) / width, (viewport.clientHeight - 58) / height, 1);
  const stage = $("stage");
  stage.style.width = Math.max(1, Math.round(width * zoom)) + "px";
  stage.style.height = Math.max(1, Math.round(height * zoom)) + "px";
  $("zoom").textContent = Math.max(.1, Math.round(zoom * 1000) / 10) + "%";
  draw();
  renderRulers(width, height);
}
function magnify(value, fitToView = false) {
  const viewport = $("viewport");
  const old = zoom;
  const centreX = viewport.scrollLeft + viewport.clientWidth / 2;
  const centreY = viewport.scrollTop + viewport.clientHeight / 2;
  fit = fitToView;
  zoom = value;
  resize();
  if (!fit) viewport.scrollTo(centreX * zoom / old - viewport.clientWidth / 2, centreY * zoom / old - viewport.clientHeight / 2);
}
$("fit").onclick = () => magnify(1, true);
$("actual").onclick = () => magnify(1);
$("zoomOut").onclick = () => magnify(Math.max(0.003, zoom / 1.3));
$("zoomIn").onclick = () => magnify(Math.min(4, zoom * 1.3));
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("board").requestFullscreen();
  } catch { setNotice("status", "Full screen is unavailable in this browser.", true); }
};
document.addEventListener("fullscreenchange", () => {
  $("fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  resize();
});
new ResizeObserver(resize).observe($("viewport"));
$("rulers").onclick = () => { toggle("rulers"); resize(); };
$("grid").onclick = () => { toggle("grid"); draw(); };
$("safe").onclick = () => { $("safeFrame").hidden = !toggle("safe"); };
$("overlayToggle").onclick = () => { toggle("overlayToggle"); draw(); };

function renderRulers(width, height) {
  const visible = on("rulers");
  $("rulerX").hidden = $("rulerY").hidden = !visible;
  $("canvasHelp").hidden = !visible || !editable();
  if (!visible) return;
  const pixels = 58 / zoom;
  const base = 10 ** Math.floor(Math.log10(pixels));
  const step = [1, 2, 5, 10].map((n) => n * base).find((n) => n >= pixels);
  for (const [id, length, edge] of [["rulerX", width, "left"], ["rulerY", height, "top"]]) {
    const ticks = [];
    for (let value = 0; value <= length && ticks.length < 550; value += step) {
      const tick = make("span", String(Math.round(value)), "tick");
      tick.style[edge] = (value / length * 100) + "%";
      ticks.push(tick);
    }
    $(id).replaceChildren(...ticks);
  }
}

function setTool(value) {
  tool = value;
  $("stage").dataset.tool = tool;
  for (const control of document.querySelectorAll("button[data-tool]")) {
    control.setAttribute("aria-pressed", control.dataset.tool === value);
  }
  if (value !== "pan" && !on("overlayToggle")) toggle("overlayToggle");
  draw();
}
document.querySelectorAll("button[data-tool]").forEach((control) => { control.onclick = () => setTool(control.dataset.tool); });
$("viewport").addEventListener("keydown", (event) => {
  if (client && ["[", "]"].includes(event.key)) openClientPosition(position + (event.key === "]" ? 1 : -1));
  if (event.key === "+") $("zoomIn").click();
  if (event.key === "-") $("zoomOut").click();
});

function svg(tag, attributes) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
function draw() {
  if (!feedback) return;
  const overlay = $("markup");
  const w = $("stage").clientWidth, h = $("stage").clientHeight;
  if (!w || !h) return;
  overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const nodes = [];
  if (on("grid")) {
    const pattern = svg("pattern", { id: "overlayGrid", width: w / 10, height: h / 10, patternUnits: "userSpaceOnUse" });
    pattern.append(svg("path", { d: `M ${w / 10} 0 H 0 V ${h / 10}`, fill: "none", stroke: "#a9d9ff", opacity: .65 }));
    nodes.push(pattern, svg("rect", { width: w, height: h, fill: "url(#overlayGrid)", "pointer-events": "none" }));
  }
  if (on("overlayToggle")) {
    feedback.guides.forEach((guide, index) => {
      if (gesture?.kind !== "guide" || gesture.index !== index) nodes.push(guideLine(guide, index, w, h));
    });
    if (gesture?.kind === "guide") nodes.push(guideLine(gesture.guide, -1, w, h));
    feedback.strokes.forEach((stroke, index) => nodes.push(drawStroke(stroke, w, h, index)));
    if (gesture?.kind === "stroke") nodes.push(drawStroke(gesture.stroke, w, h));
    feedback.notes.forEach((note, index) => nodes.push(pin(note.point, index + 1, w, h, "#80cefa")));
  }
  overlay.replaceChildren(...nodes);
}
function guideLine(guide, index, w, h) {
  const x = clamp(guide.at) * w;
  const y = clamp(guide.at) * h;
  const line = guide.axis === "x" ? { x1: x, y1: 0, x2: x, y2: h } : { x1: 0, y1: y, x2: w, y2: y };
  const group = svg("g", {});
  group.append(svg("line", { ...line, stroke: "#00e9ef", "stroke-width": 1, "stroke-dasharray": "6 3", "pointer-events": "none" }));
  if (editable()) {
    const handle = svg("line", { ...line, stroke: "transparent", "stroke-width": 13, "data-guide": index });
    handle.style.cursor = guide.axis === "x" ? "ew-resize" : "ns-resize";
    group.append(handle);
  }
  return group;
}
function pin(point, label, w, h, colour) {
  const x = point[0] * w, y = point[1] * h;
  const group = svg("g", { "pointer-events": "none" });
  const text = svg("text", { x, y: y + 4, "text-anchor": "middle", fill: "#10131a", "font-size": 11, "font-weight": 750 });
  text.textContent = label;
  group.append(svg("circle", { cx: x, cy: y, r: 10, fill: colour, stroke: "#10131a" }), text);
  return group;
}
function drawStroke(stroke, w, h, index) {
  const points = stroke.points.map(([x, y]) => [x * w, y * h]);
  const [x1, y1] = points[0], [x2, y2] = points.at(-1);
  const style = { fill: "none", stroke: stroke.colour, "stroke-width": stroke.width, "stroke-linecap": "round", "stroke-linejoin": "round" };
  const group = svg("g", { "pointer-events": "none" });
  if (stroke.kind === "box") {
    group.append(svg("rect", { ...style, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }));
  } else if (stroke.kind === "arrow") {
    const angle = Math.atan2(y2 - y1, x2 - x1), length = 9 + stroke.width;
    const tip = [x2, y2];
    const ends = [-.55, .55].map((offset) => [x2 - length * Math.cos(angle + offset), y2 - length * Math.sin(angle + offset)]);
    group.append(svg("polyline", { ...style, points: [[x1, y1], tip].map((p) => p.join(",")).join(" ") }));
    group.append(svg("polyline", { ...style, points: [ends[0], tip, ends[1]].map((p) => p.join(",")).join(" ") }));
  } else if (points.length === 1) {
    group.append(svg("circle", { cx: x1, cy: y1, r: stroke.width / 2, fill: stroke.colour }));
  } else {
    group.append(svg("polyline", { ...style, points: points.map((p) => p.join(",")).join(" ") }));
  }
  if (index !== undefined) group.append(pin(stroke.points[0], "D" + (index + 1), w, h, stroke.colour));
  return group;
}
function canvasPoint(event) {
  const rect = $("stage").getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
}
function startGesture(event) {
  if (!feedback || gesture || event.button !== 0) return;
  const point = canvasPoint(event);
  const handle = event.target.dataset.guide;
  const ruler = event.target.closest(".ruler");
  if (editable() && (handle !== undefined || ruler)) {
    const index = handle === undefined ? -1 : Number(handle);
    if (index < 0 && feedback.guides.length >= 50) return;
    const axis = feedback.guides[index]?.axis || (ruler.id === "rulerX" ? "y" : "x");
    gesture = { kind: "guide", index, guide: { axis, at: point[axis === "x" ? 0 : 1] } };
    if (!on("overlayToggle")) toggle("overlayToggle");
  } else if (!editable() || tool === "pan") {
    gesture = { kind: "pan", x: event.clientX, y: event.clientY, left: $("viewport").scrollLeft, top: $("viewport").scrollTop };
  } else if (tool === "note") {
    if (feedback.notes.length < 50) editNote("notes", -1, roundedPoint(point));
    return;
  } else {
    if (feedback.strokes.length >= 100 || feedback.strokes.reduce((n, stroke) => n + stroke.points.length, 0) >= 9000) return;
    gesture = { kind: "stroke", stroke: { kind: tool, points: [roundedPoint(point)], note: "", colour: $("colour").value, width: Number($("brush").value) } };
  }
  event.preventDefault();
  $("stage").setPointerCapture(event.pointerId);
  gesture.pointerId = event.pointerId;
  draw();
}
function moveGesture(event) {
  if (gesture?.pointerId !== event.pointerId) return;
  const point = canvasPoint(event);
  if (gesture.kind === "pan") {
    $("viewport").scrollTo(gesture.left + gesture.x - event.clientX, gesture.top + gesture.y - event.clientY);
    return;
  }
  if (gesture.kind === "guide") gesture.guide.at = point[gesture.guide.axis === "x" ? 0 : 1];
  else {
    const stroke = gesture.stroke;
    if (stroke.kind !== "pen") stroke.points.splice(1, 1, roundedPoint(point));
    else if (stroke.points.length < 400) stroke.points.push(roundedPoint(point));
  }
  draw();
}
function finishGesture(event) {
  if (gesture?.pointerId !== event.pointerId) return;
  const result = gesture;
  gesture = null;
  if (event.type === "pointerup" && result.kind === "guide") {
    const coordinate = canvasPoint(event)[result.guide.axis === "x" ? 0 : 1];
    const previous = feedback.guides.slice();
    recordUndo(() => { feedback.guides = previous; });
    if (result.index >= 0) feedback.guides.splice(result.index, 1);
    if (coordinate > 0 && coordinate < 1) feedback.guides.push({ ...result.guide, at: coordinate });
  }
  if (event.type === "pointerup" && result.kind === "stroke") {
    if (result.stroke.kind !== "pen") result.stroke.points.splice(1, 1, roundedPoint(canvasPoint(event)));
    feedback.strokes.push(result.stroke);
    recordUndo(() => feedback.strokes.pop());
  }
  draw();
  renderFeedback();
}
$("stage").addEventListener("pointerdown", startGesture);
$("stage").addEventListener("pointermove", moveGesture);
$("stage").addEventListener("pointerup", finishGesture);
$("stage").addEventListener("pointercancel", finishGesture);

function editNote(kind, index, point) {
  pendingNote = { kind, index, point };
  $("noteTitle").textContent = kind === "strokes" ? "Note on drawing" : "Canvas note";
  $("noteText").value = feedback[kind][index]?.[kind === "strokes" ? "note" : "text"] || "";
  $("noteDialog").showModal();
}
$("noteForm").onsubmit = (event) => {
  event.preventDefault();
  const text = $("noteText").value.trim();
  if (!text || !pendingNote || !editable()) return;
  const { kind, index, point } = pendingNote;
  if (index >= 0) {
    const property = kind === "strokes" ? "note" : "text";
    const previous = feedback[kind][index][property];
    recordUndo(() => { feedback[kind][index][property] = previous; });
    feedback[kind][index][property] = text;
  } else {
    feedback.notes.push({ text, point });
    recordUndo(() => feedback.notes.pop());
  }
  $("noteDialog").close();
  draw();
  renderFeedback();
};
$("undo").onclick = () => {
  undoByCreative.get(feedback)?.pop()?.();
  draw();
  renderFeedback();
};
function focusMark(point) {
  const viewport = $("viewport");
  const stage = $("stage");
  if (!on("overlayToggle")) toggle("overlayToggle");
  draw();
  viewport.scrollTo(stage.offsetLeft + stage.clientWidth * point[0] - viewport.clientWidth / 2,
    stage.offsetTop + stage.clientHeight * point[1] - viewport.clientHeight / 2);
}
function renderFeedback() {
  const list = $("feedbackList");
  list.replaceChildren();
  if (!editable() && feedback.comment) list.append(make("p", feedback.comment, "mark"));
  for (const [kind, marks] of [["notes", feedback.notes], ["strokes", feedback.strokes], ["guides", feedback.guides]]) {
    marks.forEach((mark, i) => {
      const row = make("div", "", "mark");
      const title = kind === "notes" ? `Pin ${i + 1}` : kind === "strokes" ? `D${i + 1} · ${mark.kind}` : `${mark.axis === "x" ? "Vertical" : "Horizontal"} guide · ${Math.round(mark.at * 100)}%`;
      const line = make("div", "", "actions");
      line.append(make("strong", title));
      const point = mark.point || mark.points?.[0] || (mark.axis === "x" ? [mark.at, .5] : [.5, mark.at]);
      line.append(button("Locate", () => focusMark(point)));
      if (editable()) {
        if (kind !== "guides") line.append(button(mark.note || mark.text ? "Edit note" : "Add note", () => editNote(kind, i)));
        line.append(button("Remove", () => {
          recordUndo(() => feedback[kind].splice(i, 0, mark));
          marks.splice(i, 1);
          draw();
          renderFeedback();
        }));
      }
      row.append(line);
      if (mark.text || mark.note) row.append(make("p", mark.text || mark.note));
      list.append(row);
    });
  }
  if (!list.children.length) list.append(make("p", editable() ? "Pin a note on the artwork or attach one to a drawing." : "No feedback on this version."));
  $("undo").disabled = !undoByCreative.get(feedback)?.length;
}

async function initialise() {
  if (client) {
    $("role").textContent = "Client reviewer";
    return openReview();
  }
  $("role").textContent = "Artworker";
  $("back").href = planId ? "/?saved=" + encodeURIComponent(planId) : "/";
  $("back").hidden = false;
  try {
    ownerKey = JSON.parse(localStorage.getItem("adapt-owned-plans") || "[]")
      .find((p) => p.id === planId)?.editKey || "";
  } catch {}
  if (!ownerKey) throw new Error("Open Artwork supplied from a saved plan you own to start an approval queue.");
  await loadWorkspace();
  $("workspace").hidden = false;
}

let reviewRequest = 0;
async function openReview() {
  const request = ++reviewRequest;
  navigationRequest++;
  generation++;
  $("viewer").hidden = true;
  $("title").textContent = "Opening review…";
  setNotice("status", "");
  const supplied = new URLSearchParams(location.hash.slice(1)).get("review");
  if (supplied) {
    if (reviewKey !== supplied) drafts.clear();
    reviewKey = supplied;
    try { sessionStorage.setItem(appKey, reviewKey); } catch {}
    history.replaceState(null, "", "/client-review");
  } else {
    try { reviewKey = sessionStorage.getItem(appKey) || ""; } catch {}
  }
  const result = await (await api(reviewPath)).json();
  if (request !== reviewRequest) return;
  review = result;
  $("kicker").textContent = "Artwork approval · Round " + review.number;
  $("title").textContent = review.title;
  $("intro").textContent = review.message || "Review each submitted creative and approve it or request amendments.";
  await openClientPosition(Math.max(0, review.items.findIndex((item) => !item.decision)));
}

function showUnavailable(error) {
  $("title").textContent = client ? "Review unavailable" : "Approval workspace unavailable";
  $("intro").textContent = "";
  setNotice("status", error.message, true);
}
if (client) window.addEventListener("hashchange", () => { if (location.hash) openReview().catch(showUnavailable); });
initialise().catch(showUnavailable);
