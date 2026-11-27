export function mountApprovals(root, { planId, client = false, onWorkspace } = {}) {
const $ = (name) => root.getElementById(name);
const embedded = root !== document;
const lifetime = new AbortController();
const svgNS = "http://www.w3.org/2000/svg";
const statusNames = {
  empty: "Artwork needed", draft: "Ready to submit", in_review: "In review",
  approved: "Approved", changes: "Amendments requested",
};
const blankFeedback = () => ({ comment: "", notes: [], strokes: [], guides: [] });
const drafts = new Map();
const historyByCreative = new WeakMap();
const tools = {
  pan: "Drag to pan around the artwork.",
  pen: "Draw freehand. Click the note icon on a mark to describe the change.",
  marker: "Highlight an area with a translucent marker.",
  ellipse: "Drag around the area. Hold Shift for a circle, then click its note icon.",
  arrow: "Drag towards the detail you want to point out.",
  box: "Drag a box around the area you want to call out.",
  note: "Click the artwork to pin a note at that point.",
  eraser: "Click a drawing or note pin to remove it. Use Undo to restore it.",
};
const drawingNames = { pen: "Pen stroke", marker: "Marker stroke", ellipse: "Circle / ellipse", box: "Box", arrow: "Arrow" };
const freehand = (kind) => kind === "pen" || kind === "marker";
const selected = new Set();
const markedVersions = new Set();
let workspace, review, current, feedback, pendingNote, gesture, imageUrl, generation = 0, navigationRequest = 0;
let temporaryGuides = [];
let position = 0, filter = "all", tool = "pan", zoom = 1, fit = true, busy = false;
let reviewKey = "";
let ownerKey = "", workspaceKey = "", editingVersion = "";
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
  const access = client ? { "X-Adapt-Review-Key": reviewKey }
    : workspaceKey ? { "X-Adapt-Workspace-Key": workspaceKey } : { "X-Adapt-Plan-Key": ownerKey };
  const response = await fetch(url, { signal: lifetime.signal, ...options, headers: { ...access, ...options.headers } });
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
  if (busy || lifetime.signal.aborted) return;
  busy = true;
  if (control) control.disabled = true;
  setNotice(errorId, "");
  try { await action(); }
  catch (error) { if (!lifetime.signal.aborted) setNotice(errorId, error.message, true); }
  finally {
    if (control) control.disabled = false;
    busy = false;
  }
}

async function loadWorkspace() {
  workspace = await (await api(ownerPath)).json();
  $("title").textContent = workspace.title;
  $("membersOpen").hidden = !workspace.owner || workspace.practice;
  $("practiceGuide").hidden = !workspace.practice;
  $("intro").textContent = "Supply one file per size, submit a review round and pick up amendments here.";
  const ready = new Set(workspace.formats.map((f) => f.versions[0]).filter((v) => v?.status === "draft").map((v) => v.id));
  for (const key of selected) if (!ready.has(key)) selected.delete(key);
  for (const key of ready) {
    if (!markedVersions.has(key)) selected.add(key);
    markedVersions.add(key);
  }
  renderWorkspace();
  onWorkspace?.(workspace);
}

function renderWorkspace() {
  thumbnailObserver.disconnect();
  thumbnailQueue.length = 0;
  const formats = workspace.formats;
  const supplied = formats.filter((f) => f.versions.length).length;
  const amends = formats.filter((f) => f.versions[0]?.status === "changes").length;
  $("coverage").textContent = `${supplied} of ${formats.length} sizes supplied · ${selected.size} selected · ${amends} awaiting amends`;
  $("flight").disabled = !selected.size;
  const rows = formats.filter((f) => filter === "all" || f.versions[0]?.status === filter);
  $("queue").replaceChildren(...rows.map((row) => formatCard(row, false)));
  if (!rows.length) $("queue").append(make("p", formats.length ? "No artwork in this queue." : "Add sizes to the plan to start Creative."));
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
  if (version?.note) identity.append(make("p", "Note: " + version.note));
  card.append(identity);
  if (version) card.append(thumbnail(row, version));
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
    card.classList.add("drop-ready");
    if (!version) identity.append(make("p", "Drop artwork into this box", "drop-cue"));
    const upload = make("input");
    upload.type = "file";
    upload.accept = "image/png,image/jpeg,image/webp";
    upload.hidden = true;
    const uploadButton = button(version ? "Upload new version" : "Upload artwork", () => upload.click());
    const saveFile = (file) => {
      if (!file) return;
      perform(async () => {
        await uploadArtwork(row.size, file);
        await loadWorkspace();
        setNotice("status", `Artwork saved for ${prettySize(row.size)}.`);
      }, uploadButton);
    };
    upload.onchange = () => {
      saveFile(upload.files[0]);
      upload.value = "";
    };
    card.ondragover = (event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      card.classList.add("dragging");
    };
    card.ondragleave = (event) => {
      if (!card.contains(event.relatedTarget)) card.classList.remove("dragging");
    };
    card.ondrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("dragging");
      if (event.dataTransfer.files.length > 1) {
        setNotice("status", "Drop one file into a size box, or use the delivery area for multiple files.", true);
        return;
      }
      saveFile(event.dataTransfer.files[0]);
    };
    card.append(uploadButton, upload);
  }
  if (version?.status === "draft" && !archived) card.append(button(version.note ? "Edit note" : "Add note", () => {
    editingVersion = version.id;
    $("creativeNoteInput").value = version.note || "";
    setNotice("creativeNoteError", "");
    $("creativeNoteDialog").showModal();
  }));
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

$("creativeNoteForm").onsubmit = (event) => {
  event.preventDefault();
  perform(async () => {
    await post(ownerPath + "/versions/" + editingVersion + "/note", { note: $("creativeNoteInput").value }, "PUT");
    $("creativeNoteDialog").close();
    await loadWorkspace();
  }, $("saveCreativeNote"), "creativeNoteError");
};

async function uploadArtwork(size, file) {
  const dimensions = await readDimensions(file);
  if (size !== dimensions) throw new Error(`Expected ${prettySize(size)} px. This file is ${prettySize(dimensions)} px.`);
  return storeArtwork(dimensions, file);
}

async function readDimensions(file) {
  if (file.size > 20_000_000) throw new Error("Artwork must be under 20 MB.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode().catch(() => { throw new Error("Adapt could not read this image."); });
    return `${image.naturalWidth}x${image.naturalHeight}`;
  } finally { URL.revokeObjectURL(url); }
}

async function storeArtwork(size, file) {
  return api(ownerPath + "/artwork/" + size, {
    method: "POST", body: file,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
  });
}

function addDeliveries(files) {
  if (!files.length) return;
  perform(async () => {
    const formats = new Map(workspace.formats.map((format) => [format.size, format]));
    const seen = new Set();
    const issues = [];
    let saved = 0;
    for (const file of files) {
      setNotice("status", "Saving " + file.name + "…");
      try {
        const size = await readDimensions(file);
        if (!formats.has(size)) throw new Error(`${prettySize(size)} px isn’t in this plan.`);
        if (seen.has(size)) throw new Error("Another file for this size was already saved in this batch.");
        await storeArtwork(size, file);
        seen.add(size);
        saved++;
      } catch (error) { issues.push(file.name + " — " + error.message); }
    }
    if (saved) await loadWorkspace();
    setNotice("status", `${saved} image${saved === 1 ? "" : "s"} saved to this plan.` +
      (issues.length ? " " + issues.join(" ") : ""), !!issues.length);
  }, $("chooseDelivery"));
}
$("chooseDelivery").onclick = () => $("deliveryInput").click();
$("deliveryInput").onchange = (event) => {
  addDeliveries([...event.target.files]);
  event.target.value = "";
};
$("deliveryDrop").ondragover = (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  $("deliveryDrop").classList.add("dragging");
};
$("deliveryDrop").ondragleave = (event) => {
  if (!$("deliveryDrop").contains(event.relatedTarget)) $("deliveryDrop").classList.remove("dragging");
};
$("deliveryDrop").ondrop = (event) => {
  event.preventDefault();
  event.stopPropagation();
  $("deliveryDrop").classList.remove("dragging");
  addDeliveries([...event.dataTransfer.files]);
};
$("workspace").ondragover = (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
};
$("workspace").ondrop = (event) => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  setNotice("status", "Drop artwork into an editable size box or the delivery upload area.", true);
};

const thumbnailQueue = [];
let thumbnailRequests = 0;
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    thumbnailObserver.unobserve(target);
    thumbnailQueue.push(target);
  }
  loadThumbnails();
});
function thumbnail(row, version) {
  const thumb = button("", () => openOwnerVersion(row, version));
  thumb.className = "thumb";
  thumb.setAttribute("aria-label", `Preview ${prettySize(row.size)} version ${version.number}`);
  const canvas = make("canvas");
  canvas.width = 200;
  canvas.height = 128;
  canvas.dataset.version = version.id;
  canvas.dataset.size = row.size;
  thumb.append(canvas);
  thumbnailObserver.observe(canvas);
  return thumb;
}
function loadThumbnails() {
  while (!lifetime.signal.aborted && thumbnailRequests < 2 && thumbnailQueue.length) {
    const canvas = thumbnailQueue.shift();
    if (!canvas.isConnected) continue;
    thumbnailRequests++;
    drawThumbnail(canvas).catch(() => {}).finally(() => {
      thumbnailRequests--;
      loadThumbnails();
    });
  }
}
async function drawThumbnail(canvas) {
  const response = await api(ownerPath + "/versions/" + canvas.dataset.version + "/image", { signal: lifetime.signal });
  const [w, h] = canvas.dataset.size.split("x").map(Number);
  const scale = Math.min(canvas.width / w, canvas.height / h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: width, resizeHeight: height });
  try { canvas.getContext("2d").drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2); }
  finally { bitmap.close(); }
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
    if (link && workspace.practice) {
      const action = make("a", "Try as reviewer", "button");
      action.href = link;
      action.target = "_blank";
      action.rel = "noopener";
      card.append(action);
    } else if (link) card.append(button("Review link", () => showInvite(link, round)));
    if (workspace.owner) card.append(button("Revoke link", () => {
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
  $("emailInvite").hidden = workspace.practice;
  $("tryReviewer").hidden = !workspace.practice;
  $("tryReviewer").href = link;
  if (workspace.practice) $("inviteInfo").textContent = "Open the same view a reviewer would use. Your decisions will appear back on this practice plan.";
  $("copyInvite").textContent = "Copy link";
  $("inviteDialog").showModal();
}

$("flight").onclick = () => {
  const list = workspace.formats.filter((f) => selected.has(f.versions[0]?.id));
  const omitted = workspace.formats.length - list.length;
  $("flightForm").reset();
  setNotice("flightError", "");
  const reviewerOptions = workspace.reviewers.map(({ email }) => email);
  $("reviewerOptions").replaceChildren(...reviewerOptions.map((email) => {
    const option = make("option");
    option.value = email;
    return option;
  }));
  $("recipientField").hidden = workspace.practice;
  $("recipient").required = !workspace.practice;
  $("practiceRecipient").hidden = !workspace.practice;
  $("recipient").value = workspace.practice ? "" : (workspace.rounds[0]?.recipient || reviewerOptions[0] || "");
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

async function refreshMembers() {
  const { members } = await (await api(ownerPath + "/members")).json();
  $("memberList").replaceChildren(...members.map((member) => {
    const row = make("div", "", "card");
    const label = make("div");
    label.append(make("strong", member.email), make("p", (member.role === "artworker" ? "Artworker" : "Reviewer") + (member.revoked ? " · Access revoked" : " · Active")));
    row.append(label);
    if (!member.revoked) row.append(button("Revoke access", () => {
      if (!confirm("Revoke " + member.email + "’s " + member.role + " access?")) return;
      perform(async () => {
        await api(ownerPath + "/members/" + member.id, { method: "DELETE" });
        $("memberLinkBox").hidden = true;
        await refreshMembers();
        await loadWorkspace();
      }, null, "memberError");
    }));
    return row;
  }));
  if (!members.length) $("memberList").append(make("p", "No people added yet. You have project owner access."));
}
$("membersOpen").onclick = () => perform(async () => {
  $("memberLinkBox").hidden = true;
  setNotice("memberError", "");
  await refreshMembers();
  $("membersDialog").showModal();
}, $("membersOpen"));
$("memberForm").onsubmit = (event) => {
  event.preventDefault();
  perform(async () => {
    const email = $("memberEmail").value.trim();
    const role = $("memberRole").value;
    const data = await post(ownerPath + "/members", { email, role });
    $("memberForm").reset();
    $("memberLinkBox").hidden = !data.key;
    if (data.key) {
      const link = location.origin + "/approvals?plan=" + planId + "#access=" + data.key;
      $("memberLink").value = link;
      $("emailMember").href = "mailto:" + encodeURIComponent(email) + "?subject=" +
        encodeURIComponent("Artworker access · " + workspace.title) + "&body=" +
        encodeURIComponent("Open Creative for " + workspace.title + ":\n\n" + link);
      $("copyMember").textContent = "Copy access link";
    }
    await refreshMembers();
    await loadWorkspace();
  }, $("addMember"), "memberError");
};
$("copyMember").onclick = async () => {
  $("memberLink").select();
  try {
    await navigator.clipboard.writeText($("memberLink").value);
    $("copyMember").textContent = "Copied";
  } catch { $("copyMember").textContent = "Link selected"; }
};
root.querySelectorAll("[data-close]").forEach((control) => { control.onclick = () => $(control.dataset.close).close(); });
root.querySelectorAll("[data-filter]").forEach((control) => {
  control.onclick = () => {
    filter = control.dataset.filter;
    root.querySelectorAll("[data-filter]").forEach((item) => item.setAttribute("aria-pressed", item === control));
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
  temporaryGuides = [];
  $("annotationPins").replaceChildren();
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
  $("artworkerNote").hidden = !item.note;
  $("artworkerNoteText").textContent = item.note || "";
  $("downloadVersion").hidden = true;
  $("decisionBadge").replaceChildren(item.decision ? badge(item.decision) : make("span", client ? "Awaiting review" : ""));
  $("decisionControls").hidden = !editable();
  $("changes").disabled = $("approve").disabled = true;
  $("drawingTools").hidden = !editable();
  $("markupAccess").hidden = editable();
  if (!editable()) $("markupAccess").textContent = client
    ? "This decision has been submitted. You can open saved notes and add temporary guides."
    : "Reviewer drawings and notes appear here after submission. You can open note badges and add temporary guides.";
  $("comment").value = feedback.comment;
  $("viewport").scrollTo(0, 0);
  setTool(editable() && !$("markupPanel").hidden ? "pen" : "pan");
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
  if (!client) {
    $("downloadVersion").href = imageUrl;
    $("downloadVersion").download = item.filename;
    $("downloadVersion").hidden = false;
  }
  $("artwork").src = imageUrl;
  $("artwork").alt = "Artwork for " + prettySize(item.size);
  await $("artwork").decode().catch(() => {
    if (ticket === generation) throw new Error("Adapt could not display this artwork image.");
  });
  if (ticket === generation) $("changes").disabled = $("approve").disabled = !editable();
}

function editable() { return client && current && !current.decision; }
function movableGuides() { return editable() ? feedback.guides : temporaryGuides; }
function changeGuides(change) {
  recordUndo();
  change(movableGuides());
}
function snapshotMarkup() {
  return { notes: feedback.notes.slice(), strokes: feedback.strokes.slice(), guides: feedback.guides.slice(), temporary: temporaryGuides.slice() };
}
function recordUndo() {
  const history = historyByCreative.get(feedback) || { undo: [], redo: [] };
  history.undo.push(snapshotMarkup());
  if (history.undo.length > 30) history.undo.shift();
  history.redo.length = 0;
  historyByCreative.set(feedback, history);
}
function stepMarkup(from, to) {
  if (!feedback) return;
  const history = historyByCreative.get(feedback);
  const state = history?.[from].pop();
  if (!state) return;
  history[to].push(snapshotMarkup());
  const { temporary, ...markup } = state;
  Object.assign(feedback, markup);
  temporaryGuides = temporary;
  draw();
  renderFeedback();
}
function removeAnnotation(kind, index) {
  recordUndo();
  feedback[kind].splice(index, 1);
  draw();
  renderFeedback();
}
$("backWorkspace").onclick = () => {
  generation++;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
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
  if (fit) zoom = Math.max(.001, Math.min((viewport.clientWidth - 74) / width, (viewport.clientHeight - 74) / height, 1));
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
}, { signal: lifetime.signal });
const viewportObserver = new ResizeObserver(resize);
viewportObserver.observe($("viewport"));
$("rulers").onclick = () => { toggle("rulers"); resize(); };
$("grid").onclick = () => { toggle("grid"); draw(); };
$("safe").onclick = () => { $("safeFrame").hidden = !toggle("safe"); };
$("overlayToggle").onclick = () => { toggle("overlayToggle"); draw(); };
$("markupTools").onclick = () => {
  const expanded = $("markupPanel").hidden;
  $("markupTools").setAttribute("aria-expanded", expanded);
  $("markupPanel").hidden = !expanded;
  if (expanded) {
    $("rulers").setAttribute("aria-pressed", "true");
    $("overlayToggle").setAttribute("aria-pressed", "true");
    if (editable() && tool === "pan") setTool("pen");
    resize();
  } else setTool("pan");
};
function addGuide(axis) {
  if (!feedback || movableGuides().length >= 50) return;
  $("rulers").setAttribute("aria-pressed", "true");
  if (editable()) $("overlayToggle").setAttribute("aria-pressed", "true");
  const guides = movableGuides();
  const at = [.5, .25, .75, .33, .67].find((p) => !guides.some((guide) => guide.axis === axis && Math.abs(guide.at - p) < .01)) ?? .5;
  changeGuides((items) => items.push({ axis, at }));
  resize();
  renderFeedback();
}
$("horizontalGuide").onclick = () => addGuide("y");
$("verticalGuide").onclick = () => addGuide("x");

function renderRulers(width, height) {
  const visible = on("rulers");
  $("rulerX").hidden = $("rulerY").hidden = !visible;
  $("canvasHelp").hidden = !visible;
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
  for (const control of root.querySelectorAll("button[data-tool]")) {
    control.setAttribute("aria-pressed", control.dataset.tool === value);
  }
  $("toolHint").textContent = tools[value];
  updateInkPreview();
  if (value !== "pan" && !on("overlayToggle")) toggle("overlayToggle");
  draw();
}
root.querySelectorAll("button[data-tool]").forEach((control) => { control.onclick = () => setTool(control.dataset.tool); });
const swatches = [
  ["Red", "#ea263f"], ["Orange", "#ff9d38"], ["Yellow", "#ffe052"], ["Green", "#28d799"],
  ["Blue", "#45a5ff"], ["White", "#ffffff"], ["Black", "#10131a"],
];
$("inkSwatches").append(...swatches.map(([name, colour]) => {
  const control = button("", () => { $("colour").value = colour; updateInkPreview(); });
  control.className = "ink-swatch";
  control.style.setProperty("--swatch", colour);
  control.setAttribute("aria-label", name);
  control.title = name;
  control.dataset.colour = colour;
  return control;
}));
function updateInkPreview() {
  const colour = $("colour").value;
  const sample = $("inkPreview");
  sample.setAttribute("stroke", colour);
  sample.setAttribute("stroke-width", Math.min(16, Number($("brush").value)));
  sample.setAttribute("stroke-linecap", tool === "marker" ? "square" : "round");
  sample.setAttribute("opacity", tool === "marker" ? .45 : 1);
  for (const control of $("inkSwatches").children) control.setAttribute("aria-pressed", control.dataset.colour === colour);
}
$("colour").oninput = $("brush").onchange = updateInkPreview;
$("viewer").addEventListener("keydown", (event) => {
  if ($("markupPanel").hidden || event.target.closest("input, textarea, select, [contenteditable]")) return;
  if (!(event.metaKey || event.ctrlKey) || !["z", "y"].includes(event.key.toLowerCase())) return;
  event.preventDefault();
  const redo = event.shiftKey || event.key.toLowerCase() === "y";
  stepMarkup(redo ? "redo" : "undo", redo ? "undo" : "redo");
});
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
      if (!editable()) nodes.push(guideLine(guide, null, w, h));
      else if (gesture?.kind !== "guide" || gesture.index !== index) nodes.push(guideLine(guide, index, w, h));
    });
    feedback.strokes.forEach((stroke, index) => nodes.push(drawStroke(stroke, w, h, index)));
    if (gesture?.kind === "stroke") nodes.push(drawStroke(gesture.stroke, w, h));
  }
  temporaryGuides.forEach((guide, index) => {
    if (gesture?.kind !== "guide" || gesture.index !== index) nodes.push(guideLine(guide, index, w, h));
  });
  if (gesture?.kind === "guide") nodes.push(guideLine(gesture.guide, null, w, h));
  overlay.replaceChildren(...nodes);
  if (!gesture) renderPins(w, h);
}
function guideLine(guide, index, w, h) {
  const x = clamp(guide.at) * w;
  const y = clamp(guide.at) * h;
  const line = guide.axis === "x" ? { x1: x, y1: 0, x2: x, y2: h } : { x1: 0, y1: y, x2: w, y2: y };
  const group = svg("g", {});
  group.append(svg("line", { ...line, stroke: "#00e9ef", "stroke-width": 1, "stroke-dasharray": "6 3", "pointer-events": "none" }));
  if (index !== null) {
    const handle = svg("line", { ...line, stroke: "transparent", "stroke-width": 18, "pointer-events": "stroke", "data-guide": index });
    handle.style.cursor = guide.axis === "x" ? "ew-resize" : "ns-resize";
    group.append(handle);
  }
  return group;
}
function annotationPoint(kind, mark) {
  if (kind === "notes") return mark.point;
  const [first] = mark.points;
  if (freehand(mark.kind)) return first;
  const last = mark.points.at(-1);
  if (mark.kind === "arrow") return last;
  return [Math.max(first[0], last[0]), Math.min(first[1], last[1])];
}
function annotationLabel(kind, mark, index) {
  return kind === "notes" ? `Pin ${index + 1}` : `${drawingNames[mark.kind]} ${index + 1}`;
}
function renderPins(w, h) {
  const layer = $("annotationPins");
  const existing = new Map([...layer.children].map((pin) => [pin.dataset.pin, pin]));
  const keep = new Set();
  if (on("overlayToggle")) {
    for (const kind of ["notes", "strokes"]) {
      feedback[kind].forEach((mark, index) => {
        const content = kind === "notes" ? mark.text : mark.note;
        if (!content && !editable()) return;
        const key = kind + ":" + index;
        keep.add(key);
        let pin = existing.get(key);
        if (!pin) {
          pin = button("", () => {
            if (editable() && tool === "eraser") removeAnnotation(kind, index);
            else editNote(kind, index);
          });
          pin.dataset.pin = key;
          pin.className = "annotation-pin";
          const icon = svg("svg", { width: 13, height: 13, viewBox: "0 0 16 16", "aria-hidden": "true" });
          icon.append(svg("path", { d: "M2 2.5h12v8.2H7l-3.5 3v-3H2Z", fill: "none", stroke: "currentColor", "stroke-width": 1.4, "stroke-linejoin": "round" }));
          pin.append(icon, make("span"));
          layer.append(pin);
        }
        pin.lastElementChild.textContent = kind === "notes" ? String(index + 1) : "D" + (index + 1);
        const title = annotationLabel(kind, mark, index);
        const action = editable() && tool === "eraser" ? "Erase "
          : !editable() ? "Read note on " : content ? "Edit note on " : "Add note to ";
        pin.title = action + title;
        pin.setAttribute("aria-label", pin.title);
        pin.style.setProperty("--mark-colour", kind === "notes" ? "#80cefa" : mark.colour);
        const [x, y] = annotationPoint(kind, mark);
        const offset = kind === "strokes" ? 13 : 0;
        pin.style.left = Math.max(Math.min(w / 2, 17), Math.min(w - 17, x * w + offset)) + "px";
        pin.style.top = Math.max(Math.min(h / 2, 14), Math.min(h - 14, y * h - offset)) + "px";
      });
    }
  }
  for (const [key, pin] of existing) if (!keep.has(key)) pin.remove();
}
function smoothPath(points) {
  const path = ["M", ...points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nextX, nextY] = points[i + 1];
    path.push("Q", x, y, (x + nextX) / 2, (y + nextY) / 2);
  }
  path.push("L", ...points.at(-1));
  return path.join(" ");
}
function drawStroke(stroke, w, h, index) {
  const points = stroke.points.map(([x, y]) => [x * w, y * h]);
  const [x1, y1] = points[0], [x2, y2] = points.at(-1);
  const marker = stroke.kind === "marker";
  const style = { fill: "none", stroke: stroke.colour, "stroke-width": stroke.width, "stroke-linecap": marker ? "square" : "round", "stroke-linejoin": "round" };
  const group = svg("g", { "pointer-events": "none", "data-stroke-kind": stroke.kind, opacity: marker ? .45 : 1 });
  if (stroke.kind === "box") {
    group.append(svg("rect", { ...style, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }));
  } else if (stroke.kind === "ellipse") {
    group.append(svg("ellipse", { ...style, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 }));
  } else if (stroke.kind === "arrow") {
    const angle = Math.atan2(y2 - y1, x2 - x1), length = 9 + stroke.width;
    const tip = [x2, y2];
    const ends = [-.55, .55].map((offset) => [x2 - length * Math.cos(angle + offset), y2 - length * Math.sin(angle + offset)]);
    group.append(svg("polyline", { ...style, points: [[x1, y1], tip].map((p) => p.join(",")).join(" ") }));
    group.append(svg("polyline", { ...style, points: [ends[0], tip, ends[1]].map((p) => p.join(",")).join(" ") }));
  } else if (points.length === 1) {
    group.append(svg("circle", { cx: x1, cy: y1, r: stroke.width / 2, fill: stroke.colour }));
  } else {
    group.append(svg("path", { ...style, d: smoothPath(points) }));
  }
  if (index !== undefined && editable() && tool === "eraser") {
    group.dataset.eraseStroke = index;
    for (const shape of [...group.children]) {
      const target = shape.cloneNode(false);
      target.setAttribute("stroke", "transparent");
      target.setAttribute("stroke-width", String(stroke.width + 12));
      target.setAttribute("pointer-events", "stroke");
      group.append(target);
    }
  }
  return group;
}
function canvasPoint(event) {
  const rect = $("stage").getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
}
function shapeEnd(event, stroke) {
  const point = roundedPoint(canvasPoint(event));
  if (stroke.kind !== "ellipse" || !event.shiftKey) return point;
  const [x, y] = stroke.points[0];
  const { width, height } = $("stage").getBoundingClientRect();
  const sx = point[0] < x ? -1 : 1;
  const sy = point[1] < y ? -1 : 1;
  const span = Math.min(Math.max(Math.abs(point[0] - x) * width, Math.abs(point[1] - y) * height),
    (sx < 0 ? x : 1 - x) * width, (sy < 0 ? y : 1 - y) * height);
  return roundedPoint([x + sx * span / width, y + sy * span / height]);
}
function sampleStroke(stroke, event, limit) {
  const points = stroke.points;
  const point = roundedPoint(canvasPoint(event));
  const last = points.at(-1);
  if (last[0] === point[0] && last[1] === point[1]) return;
  if (points.length >= limit) {
    if (limit <= 3) points.splice(1);
    else stroke.points = points.filter((_, index) => index % 2 === 0);
  }
  stroke.points.push(point);
}
let drawingFrame = 0;
function redrawDuringGesture() {
  if (drawingFrame) return;
  drawingFrame = requestAnimationFrame(() => {
    drawingFrame = 0;
    draw();
  });
}
function startGesture(event) {
  if (!feedback || gesture || event.button !== 0 || event.target.closest(".annotation-pin")) return;
  const point = canvasPoint(event);
  const handle = event.target.dataset.guide;
  const ruler = event.target.closest(".ruler");
  if (handle !== undefined || ruler) {
    const index = handle === undefined ? -1 : Number(handle);
    const guides = movableGuides();
    if (index < 0 && guides.length >= 50) return;
    const axis = guides[index]?.axis || (ruler?.id === "rulerX" ? "y" : "x");
    gesture = { kind: "guide", index, guide: { axis, at: point[axis === "x" ? 0 : 1] } };
    if (editable() && !on("overlayToggle")) toggle("overlayToggle");
  } else if (editable() && tool === "eraser") {
    const target = event.target.closest("[data-erase-stroke]");
    if (target) removeAnnotation("strokes", Number(target.dataset.eraseStroke));
    return;
  } else if (!editable() || tool === "pan") {
    gesture = { kind: "pan", x: event.clientX, y: event.clientY, left: $("viewport").scrollLeft, top: $("viewport").scrollTop };
  } else if (tool === "note") {
    if (feedback.notes.length < 50) editNote("notes", -1, roundedPoint(point));
    return;
  } else {
    const remaining = 9000 - feedback.strokes.reduce((total, stroke) => total + stroke.points.length, 0);
    if (feedback.strokes.length >= 100 || remaining < 2) {
      $("toolHint").textContent = "This creative has reached its drawing limit. Erase a mark to make room.";
      return;
    }
    gesture = { kind: "stroke", limit: Math.min(remaining, 400),
      stroke: { kind: tool, points: [roundedPoint(point)], note: "", colour: $("colour").value, width: Number($("brush").value) } };
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
    if (freehand(stroke.kind)) {
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) sampleStroke(stroke, sample, gesture.limit);
    } else stroke.points.splice(1, 1, shapeEnd(event, stroke));
  }
  redrawDuringGesture();
}
function finishGesture(event) {
  if (gesture?.pointerId !== event.pointerId) return;
  const result = gesture;
  gesture = null;
  if (event.type === "pointerup" && result.kind === "guide") {
    const point = canvasPoint(event);
    const inside = point.every((coordinate) => coordinate > 0 && coordinate < 1);
    if (inside || result.index >= 0) changeGuides((guides) => {
      const nextGuide = { ...result.guide, at: point[result.guide.axis === "x" ? 0 : 1] };
      if (result.index < 0) guides.push(nextGuide);
      else if (inside) guides.splice(result.index, 1, nextGuide);
      else guides.splice(result.index, 1);
    });
  }
  if (event.type === "pointerup" && result.kind === "stroke") {
    const stroke = result.stroke;
    if (freehand(stroke.kind)) sampleStroke(stroke, event, result.limit);
    else stroke.points.splice(1, 1, shapeEnd(event, stroke));
    if (freehand(stroke.kind) || stroke.points[0].some((value, i) => value !== stroke.points[1][i])) {
      recordUndo();
      feedback.strokes.push(stroke);
    }
  }
  draw();
  renderFeedback();
}
$("stage").addEventListener("pointerdown", startGesture);
$("stage").addEventListener("pointermove", moveGesture);
$("stage").addEventListener("pointerup", finishGesture);
$("stage").addEventListener("pointercancel", finishGesture);
$("stage").addEventListener("lostpointercapture", finishGesture);

function editNote(kind, index, point) {
  const mark = feedback[kind][index];
  const text = mark?.[kind === "strokes" ? "note" : "text"] || "";
  const editing = editable();
  if ((!text && !editing) || $("noteDialog").open) return;
  pendingNote = editing ? { kind, index, point } : null;
  $("noteTitle").textContent = mark ? annotationLabel(kind, mark, index) : "Canvas note";
  $("noteField").hidden = $("saveNote").hidden = !editing;
  $("noteReadOnly").hidden = editing;
  $("noteReadOnly").textContent = text;
  $("noteText").value = editing ? text : "";
  $("closeNote").textContent = editing ? "Cancel" : "Close";
  $("noteDialog").showModal();
  if (editing) $("noteText").focus();
}
$("noteForm").onsubmit = (event) => {
  event.preventDefault();
  const text = $("noteText").value.trim();
  if (!text || !pendingNote || !editable()) return;
  const { kind, index, point } = pendingNote;
  recordUndo();
  if (index >= 0) {
    const property = kind === "strokes" ? "note" : "text";
    feedback[kind][index] = { ...feedback[kind][index], [property]: text };
  } else {
    feedback.notes.push({ text, point });
  }
  $("noteDialog").close();
  draw();
  renderFeedback();
};
$("undo").onclick = () => stepMarkup("undo", "redo");
$("redo").onclick = () => stepMarkup("redo", "undo");
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
      const title = kind === "guides" ? `${mark.axis === "x" ? "Vertical" : "Horizontal"} guide · ${Math.round(mark.at * 100)}%` : annotationLabel(kind, mark, i);
      const line = make("div", "", "actions");
      line.append(make("strong", title));
      const point = kind === "guides" ? (mark.axis === "x" ? [mark.at, .5] : [.5, mark.at]) : annotationPoint(kind, mark);
      line.append(button("Locate", () => focusMark(point)));
      if (!editable() && (mark.text || mark.note)) line.append(button("Read note", () => editNote(kind, i)));
      if (editable()) {
        if (kind !== "guides") line.append(button(mark.note || mark.text ? "Edit note" : "Add note", () => editNote(kind, i)));
        line.append(button("Remove", () => {
          if (kind === "guides") changeGuides((guides) => guides.splice(i, 1));
          else { removeAnnotation(kind, i); return; }
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
  temporaryGuides.forEach((guide, index) => {
    const row = make("div", "", "mark actions");
    row.append(make("strong", `Temporary ${guide.axis === "x" ? "vertical" : "horizontal"} guide · ${Math.round(guide.at * 100)}%`),
      button("Remove", () => {
        changeGuides((guides) => guides.splice(index, 1));
        draw();
        renderFeedback();
      }));
    list.append(row);
  });
  const history = historyByCreative.get(feedback);
  $("undo").disabled = !history?.undo.length;
  $("redo").disabled = !history?.redo.length;
}

async function initialise() {
  if (client) {
    $("role").textContent = "Reviewer";
    return openReview();
  }
  if (!embedded) {
    $("role").textContent = "Artworker";
    $("back").href = planId ? "/?saved=" + encodeURIComponent(planId) + "&view=creative" : "/";
    $("back").hidden = false;
    const access = new URLSearchParams(location.hash.slice(1)).get("access");
    try {
      if (access) sessionStorage.setItem("adapt-artworker-" + planId, access);
      workspaceKey = access || sessionStorage.getItem("adapt-artworker-" + planId) || "";
    } catch { workspaceKey = access || ""; }
    if (access) history.replaceState(null, "", location.pathname + location.search);
    if (workspaceKey) $("back").hidden = true;
  }
  try {
    ownerKey = JSON.parse(localStorage.getItem("adapt-owned-plans") || "[]")
      .find((p) => p.id === planId)?.editKey || "";
  } catch {}
  if (!ownerKey && !workspaceKey) throw new Error("Open Creative from the plan owner’s browser or use an artworker link.");
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
  $("role").textContent = review.practicePlan ? "Practice reviewer" : "Reviewer";
  $("back").hidden = !review.practicePlan;
  if (review.practicePlan) {
    $("back").textContent = "Back to practice Creative";
    $("back").href = "/?saved=" + review.practicePlan + "&view=creative";
  }
  $("kicker").textContent = "Artwork approval · Round " + review.number;
  $("title").textContent = review.title;
  $("intro").textContent = review.message || "Review each submitted creative and approve it or request amendments.";
  await openClientPosition(Math.max(0, review.items.findIndex((item) => !item.decision)));
}

function showUnavailable(error) {
  if (lifetime.signal.aborted) return;
  $("title").textContent = client ? "Review unavailable" : "Approval workspace unavailable";
  $("intro").textContent = "";
  setNotice("status", error.message, true);
}
if (client) window.addEventListener("hashchange", () => { if (location.hash) openReview().catch(showUnavailable); }, { signal: lifetime.signal });
const ready = initialise().catch(showUnavailable);
return {
  ready,
  refresh: () => perform(loadWorkspace),
  destroy() {
    lifetime.abort();
    cancelAnimationFrame(drawingFrame);
    generation++;
    viewportObserver.disconnect();
    thumbnailObserver.disconnect();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  },
};
}

if (document.getElementById("role")) {
  mountApprovals(document, {
    planId: new URLSearchParams(location.search).get("plan"),
    client: location.pathname === "/client-review",
  });
}
