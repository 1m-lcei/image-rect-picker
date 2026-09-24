import {
  adjustRect,
  clamp,
  drawRect,
  editRect,
  fitScale,
  type Handle,
  imagePoint,
  initialRect,
  type Point,
  type Rect,
  visibleHandles,
} from "./geometry";
import { type LoadedImage, loadImage } from "./image";
import { formatRect } from "./output";
import { loadSettings, saveSettings } from "./settings";
import { initTheme } from "./theme";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
}

const fileInput = element<HTMLInputElement>("file");
const viewport = element<HTMLElement>("viewport");
const stage = element<HTMLDivElement>("stage");
const imageElement = element<HTMLImageElement>("image");
const selection = element<HTMLDivElement>("selection");
const coordinates = element<HTMLFieldSetElement>("coordinates");
const zoomControls = element<HTMLFieldSetElement>("zoom-controls");
const template = element<HTMLInputElement>("template");
const output = element<HTMLInputElement>("output");
const copy = element<HTMLButtonElement>("copy");
const copyFeedback = element<HTMLSpanElement>("copy-feedback");
const clear = element<HTMLButtonElement>("clear");
const errorBox = element<HTMLDivElement>("error");
const status = element<HTMLParagraphElement>("status");
const fields = ["x", "y", "width", "height"] as const;
const inputs = Object.fromEntries(
  fields.map((field) => [field, element<HTMLInputElement>(field)]),
) as Record<keyof Rect, HTMLInputElement>;
const fitButton = element<HTMLButtonElement>("fit");
const zoomValue = element<HTMLOutputElement>("zoom-value");
const panButton = element<HTMLButtonElement>("pan");
const handles = selection.querySelectorAll<HTMLButtonElement>(".handle");

const settings = loadSettings();
initTheme(element<HTMLButtonElement>("theme-toggle"), settings);
saveSettings(settings);

const menuTrigger = element<HTMLButtonElement>("menu-trigger");
element("about-dialog").addEventListener("close", () => menuTrigger.focus());

// Without a close button, touch users also need light dismiss in older browsers.
if (!("closedBy" in HTMLDialogElement.prototype)) {
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        dialog.close();
    });
  }
}

let image: LoadedImage | null = null;
let rect: Rect | null = null;
let scale = 1;
let fit = true;
let loadRequest = 0;
let loading = false;
let pendingFile: File | null = null;
let readingImage = false;
let panMode = false;
let spacePressed = false;
let drag: {
  pointerId: number;
  handle: Handle | "draw" | "pan";
  rect: Rect | null;
  start: Point;
  client: Point;
  scroll: Point;
  moved: boolean;
} | null = null;

template.value = settings.template;

function showError(message: string): void {
  element("error-text").textContent = message;
  errorBox.hidden = !message;
}

function announceRect(): void {
  if (rect)
    status.textContent = `選択範囲: X ${rect.x}、Y ${rect.y}、幅 ${rect.width}、高さ ${rect.height} px。`;
}

function renderRect(): void {
  coordinates.disabled = !rect || !!drag;
  zoomControls.disabled = !image || !!drag;
  clear.disabled = !image && !loading;
  copy.disabled = !rect;
  selection.hidden = !rect;
  renderPanState();
  output.value = formatRect(rect, template.value);
  for (const field of fields) {
    const input = inputs[field];
    input.value = rect ? String(rect[field]) : "";
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
  }
  if (!rect || !image) return;
  Object.assign(selection.style, {
    left: `${rect.x * scale}px`,
    top: `${rect.y * scale}px`,
    width: `${rect.width * scale}px`,
    height: `${rect.height * scale}px`,
  });
  inputs.x.max = String(image.width - rect.width);
  inputs.y.max = String(image.height - rect.height);
  inputs.width.max = String(image.width - rect.x);
  inputs.height.max = String(image.height - rect.y);
  renderHandles();
}

function renderHandles(): void {
  if (!image || !rect) return;
  const box = selection.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  const x = Math.max(0, frame.left + viewport.clientLeft);
  const y = Math.max(0, frame.top + viewport.clientTop);
  const positions = visibleHandles(
    { x: box.left, y: box.top, width: box.width, height: box.height },
    {
      x,
      y,
      width:
        Math.min(
          innerWidth,
          frame.left + viewport.clientLeft + viewport.clientWidth,
        ) - x,
      height:
        Math.min(
          innerHeight,
          frame.top + viewport.clientTop + viewport.clientHeight,
        ) - y,
    },
  );
  for (const button of handles) {
    const point = positions[button.dataset.handle as Exclude<Handle, "move">];
    button.hidden = !point;
    if (point) {
      button.style.left = `${point.x - box.left}px`;
      button.style.top = `${point.y - box.top}px`;
    }
  }
}

function renderPanState(): void {
  panButton.setAttribute("aria-pressed", String(panMode));
  viewport.classList.toggle("pan-ready", !!image && (panMode || spacePressed));
  viewport.classList.toggle("panning", drag?.handle === "pan");
}

function currentFit(): number {
  return image
    ? fitScale(image, {
        width: viewport.clientWidth - 40,
        height: viewport.clientHeight - 40,
      })
    : 1;
}

function renderScale(): void {
  if (!image) return;
  stage.style.width = `${image.width * scale}px`;
  stage.style.height = `${image.height * scale}px`;
  zoomValue.value = `${Number((scale * 100).toFixed(2))}%`;
  renderRect();
}

function fitImage(): void {
  if (!image || drag) return;
  fit = true;
  scale = currentFit();
  renderScale();
  viewport.scrollTo(0, 0);
  renderHandles();
}

function zoom(next: number, anchor?: Point): void {
  if (!image || drag) return;
  const box = viewport.getBoundingClientRect();
  const client = anchor ?? {
    x: box.left + viewport.clientLeft + viewport.clientWidth / 2,
    y: box.top + viewport.clientTop + viewport.clientHeight / 2,
  };
  const before = pointOnImage(client);
  scale = clamp(next, Math.min(0.1, currentFit()), 10);
  fit = false;
  renderScale();
  const after = stage.getBoundingClientRect();
  viewport.scrollLeft += after.left + before.x * scale - client.x;
  viewport.scrollTop += after.top + before.y * scale - client.y;
  renderHandles();
}

function pointOnImage(client: Point): Point {
  const box = stage.getBoundingClientRect();
  return imagePoint(client, { x: box.left, y: box.top }, scale);
}

async function openFiles(files: FileList): Promise<void> {
  if (files.length === 0) return;
  ++loadRequest;
  pendingFile = null;
  finishDrag(true);
  showError("");
  loading = false;
  if (files.length !== 1 || !files[0]) {
    showError("画像は一度に1枚だけ選択してください。");
    viewport.setAttribute("aria-busy", "false");
    status.textContent = "画像の読み込みを中止しました。";
    renderRect();
    return;
  }
  loading = true;
  viewport.setAttribute("aria-busy", "true");
  status.textContent = "画像を読み込んでいます…";
  renderRect();
  pendingFile = files[0];
  if (readingImage) return;
  readingImage = true;
  try {
    while (pendingFile) {
      const file = pendingFile;
      const request = loadRequest;
      pendingFile = null;
      try {
        const next = await loadImage(file);
        if (request !== loadRequest) {
          URL.revokeObjectURL(next.url);
          continue;
        }
        finishDrag(true);
        const previous = image;
        image = next;
        rect = null;
        imageElement.src = next.url;
        imageElement.alt = next.name;
        if (previous) URL.revokeObjectURL(previous.url);
        element("image-name").textContent = next.name;
        stage.hidden = false;
        fitImage();
        status.textContent =
          "画像を開きました。ドラッグで範囲を選択してください。画像表示領域にフォーカス + Enterでも選択を開始できます。";
      } catch (error) {
        if (request !== loadRequest) continue;
        showError(
          error instanceof Error
            ? error.message
            : "画像の読み込みに失敗しました。",
        );
        status.textContent = image
          ? "現在の画像と選択範囲を保持しています。"
          : "別の画像を選択してください。";
      } finally {
        if (request === loadRequest) {
          loading = false;
          viewport.setAttribute("aria-busy", "false");
          renderRect();
        }
      }
    }
  } finally {
    readingImage = false;
  }
}

fileInput.addEventListener("change", () => {
  if (fileInput.files) void openFiles(fileInput.files);
  fileInput.value = "";
});

clear.addEventListener("click", () => {
  ++loadRequest;
  pendingFile = null;
  loading = false;
  finishDrag(true);
  if (image) URL.revokeObjectURL(image.url);
  image = null;
  rect = null;
  imageElement.removeAttribute("src");
  imageElement.alt = "";
  stage.hidden = true;
  viewport.setAttribute("aria-busy", "false");
  element("image-name").textContent = "画像を選択、または下の領域にドロップ";
  zoomValue.value = "—";
  fit = true;
  showError("");
  renderRect();
  status.textContent = "画像をクリアしました。";
  fileInput.focus();
});

for (const type of ["dragenter", "dragover"]) {
  viewport.addEventListener(type, (event) => {
    const dragEvent = event as DragEvent;
    if (!dragEvent.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragEvent.dataTransfer.dropEffect = "copy";
    viewport.classList.add("drag-over");
  });
}
viewport.addEventListener("dragleave", (event) => {
  if (
    !(event.relatedTarget instanceof Node) ||
    !viewport.contains(event.relatedTarget)
  ) {
    viewport.classList.remove("drag-over");
  }
});
viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  viewport.classList.remove("drag-over");
  if (event.dataTransfer) void openFiles(event.dataTransfer.files);
});
// Dropping outside the workspace must not navigate away from the current image.
for (const type of ["dragover", "drop"]) {
  document.addEventListener(type, (event) => {
    if ((event as DragEvent).dataTransfer?.types.includes("Files"))
      event.preventDefault();
  });
}

function handleFrom(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element
    ? target.closest<HTMLButtonElement>("[data-handle]")
    : null;
}

viewport.addEventListener("pointerdown", (event) => {
  if (!image || drag || !event.isPrimary) return;
  const panning =
    event.button === 1 || (event.button === 0 && (panMode || spacePressed));
  if (
    !panning &&
    (event.button !== 0 ||
      !(event.target instanceof Node) ||
      !stage.contains(event.target))
  )
    return;
  const frame = viewport.getBoundingClientRect();
  if (
    event.clientX >= frame.left + viewport.clientLeft + viewport.clientWidth ||
    event.clientY >= frame.top + viewport.clientTop + viewport.clientHeight
  )
    return;
  event.preventDefault();
  const button = handleFrom(event.target);
  const client = { x: event.clientX, y: event.clientY };
  drag = {
    pointerId: event.pointerId,
    handle: panning
      ? "pan"
      : ((button?.dataset.handle as Handle | undefined) ?? "draw"),
    rect,
    start: pointOnImage(client),
    client,
    scroll: { x: viewport.scrollLeft, y: viewport.scrollTop },
    moved: false,
  };
  (panning ? viewport : (button ?? viewport)).focus({ preventScroll: true });
  viewport.setPointerCapture(event.pointerId);
  renderRect();
});

function updateDrag(event: PointerEvent): void {
  if (!drag || !image || event.pointerId !== drag.pointerId) return;
  const client = { x: event.clientX, y: event.clientY };
  if (drag.handle === "pan") {
    viewport.scrollLeft = drag.scroll.x - (client.x - drag.client.x);
    viewport.scrollTop = drag.scroll.y - (client.y - drag.client.y);
    renderHandles();
    return;
  }
  const current = pointOnImage(client);
  if (Math.hypot(client.x - drag.client.x, client.y - drag.client.y) >= 3)
    drag.moved = true;
  if (drag.handle === "draw") {
    if (!drag.moved) return;
    rect = drawRect(drag.start, current, image);
  } else if (drag.rect) {
    rect = adjustRect(
      drag.rect,
      drag.handle,
      {
        x: current.x - drag.start.x,
        y: current.y - drag.start.y,
      },
      image,
    );
  }
  renderRect();
}

function finishDrag(cancel: boolean): void {
  if (!drag) return;
  const previous = drag;
  drag = null;
  if (cancel) rect = previous.rect;
  if (cancel && previous.handle === "pan")
    viewport.scrollTo(previous.scroll.x, previous.scroll.y);
  if (viewport.hasPointerCapture(previous.pointerId))
    viewport.releasePointerCapture(previous.pointerId);
  renderRect();
  if (fit && previous.handle !== "pan") fitImage();
  if (cancel) status.textContent = "ドラッグを取り消しました。";
  else if (previous.handle === "pan")
    status.textContent = "表示位置を移動しました。";
  else announceRect();
}

viewport.addEventListener("pointermove", updateDrag);
viewport.addEventListener("pointerup", (event) => {
  if (event.pointerId !== drag?.pointerId) return;
  updateDrag(event);
  finishDrag(false);
});
for (const type of ["pointercancel", "lostpointercapture"]) {
  viewport.addEventListener(type, (event) => {
    if ((event as PointerEvent).pointerId === drag?.pointerId) finishDrag(true);
  });
}
window.addEventListener("blur", () => {
  spacePressed = false;
  finishDrag(true);
  renderPanState();
});
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    finishDrag(true);
  }
  if (
    event.code === "Space" &&
    image &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest("input, textarea, select, [contenteditable]") ||
      (target?.closest("button") && !viewport.contains(target))
    )
      return;
    if (
      viewport.matches(":hover") ||
      viewport.contains(document.activeElement)
    ) {
      event.preventDefault();
      spacePressed = true;
      renderPanState();
    }
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    spacePressed = false;
    renderPanState();
  }
});
panButton.addEventListener("click", () => {
  panMode = !panMode;
  renderPanState();
});
viewport.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});

viewport.addEventListener("keydown", (event) => {
  if (
    event.key !== "Enter" ||
    event.target !== viewport ||
    !image ||
    rect ||
    drag
  )
    return;
  event.preventDefault();
  rect = initialRect(image);
  renderRect();
  element("move").focus({ preventScroll: true });
  announceRect();
});

stage.addEventListener("keydown", (event) => {
  if (!rect || !image || drag || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const button = handleFrom(event.target);
  if (!button) return;
  const step = event.shiftKey ? 10 : 1;
  const delta: Point | undefined = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  }[event.key];
  if (!delta) return;
  event.preventDefault();
  rect = adjustRect(rect, button.dataset.handle as Handle, delta, image);
  renderRect();
  announceRect();
});

for (const field of fields) {
  const input = inputs[field];
  const commit = () => {
    if (!rect || !image || drag) return;
    try {
      rect = editRect(rect, field, input.value, image);
      showError("");
      renderRect();
      announceRect();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "整数を入力してください。";
      input.setCustomValidity(message);
      input.setAttribute("aria-invalid", "true");
      showError(message);
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  input.addEventListener("input", () => {
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
  });
}

template.addEventListener("input", () => {
  output.value = formatRect(rect, template.value);
  settings.template = template.value;
  saveSettings(settings);
});
copyFeedback.addEventListener("animationend", () => {
  copyFeedback.hidePopover?.();
  copyFeedback.hidden = true;
});
copy.addEventListener("click", async () => {
  const text = output.value;
  copyFeedback.hidePopover?.();
  copyFeedback.hidden = true;
  try {
    await navigator.clipboard.writeText(text);
    copyFeedback.hidden = false;
    copyFeedback.showPopover?.();
    for (const animation of copyFeedback.getAnimations())
      animation.currentTime = 0;
  } catch {
    output.focus();
    output.select();
    status.textContent =
      "自動コピーできませんでした。出力欄をテキスト選択してコピーしてください。";
  }
});
element("dismiss-error").addEventListener("click", () => showError(""));
element("zoom-in").addEventListener("click", () => zoom(scale * 1.1));
element("zoom-out").addEventListener("click", () => zoom(scale / 1.1));
element("actual-size").addEventListener("click", () => zoom(1));
fitButton.addEventListener("click", fitImage);
viewport.addEventListener(
  "wheel",
  (event) => {
    if (!image || event.ctrlKey || event.metaKey || event.deltaY === 0) return;
    event.preventDefault();
    if (!drag)
      zoom(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
        x: event.clientX,
        y: event.clientY,
      });
  },
  { passive: false },
);

new ResizeObserver(() => {
  if (fit && !drag) fitImage();
  else renderHandles();
}).observe(viewport);
viewport.addEventListener("scroll", renderHandles, { passive: true });
window.addEventListener("scroll", renderHandles, { passive: true });
window.addEventListener("resize", renderHandles);

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    ++loadRequest;
    pendingFile = null;
    if (image) URL.revokeObjectURL(image.url);
  }
});
