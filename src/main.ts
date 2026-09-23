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
} from "./geometry";
import { type LoadedImage, loadImage } from "./image";
import { DEFAULT_TEMPLATE, formatRect } from "./output";
import "./index.css";

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
const empty = element<HTMLDivElement>("empty");
const coordinates = element<HTMLFieldSetElement>("coordinates");
const zoomControls = element<HTMLFieldSetElement>("zoom-controls");
const template = element<HTMLInputElement>("template");
const output = element<HTMLInputElement>("output");
const copy = element<HTMLButtonElement>("copy");
const clear = element<HTMLButtonElement>("clear");
const errorBox = element<HTMLDivElement>("error");
const status = element<HTMLParagraphElement>("status");
const fields = ["x", "y", "width", "height"] as const;
const inputs = Object.fromEntries(
  fields.map((field) => [field, element<HTMLInputElement>(field)]),
) as Record<keyof Rect, HTMLInputElement>;
const fitButton = element<HTMLButtonElement>("fit");
const zoomValue = element<HTMLOutputElement>("zoom-value");

let image: LoadedImage | null = null;
let rect: Rect | null = null;
let scale = 1;
let fit = true;
let loadRequest = 0;
let loading = false;
let drag: {
  pointerId: number;
  handle: Handle | "draw";
  rect: Rect;
  start: Point;
  client: Point;
  moved: boolean;
} | null = null;

template.value = DEFAULT_TEMPLATE;

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
  output.value = formatRect(rect, template.value);
  if (!rect || !image) return;
  Object.assign(selection.style, {
    left: `${rect.x * scale}px`,
    top: `${rect.y * scale}px`,
    width: `${rect.width * scale}px`,
    height: `${rect.height * scale}px`,
  });
  for (const field of fields) {
    const input = inputs[field];
    input.value = String(rect[field]);
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
  }
  inputs.x.max = String(image.width - rect.width);
  inputs.y.max = String(image.height - rect.height);
  inputs.width.max = String(image.width - rect.x);
  inputs.height.max = String(image.height - rect.y);
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
  fitButton.setAttribute("aria-pressed", String(fit));
  renderRect();
}

function fitImage(): void {
  if (!image || drag) return;
  fit = true;
  scale = currentFit();
  renderScale();
  viewport.scrollTo(0, 0);
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
}

function pointOnImage(client: Point): Point {
  const box = stage.getBoundingClientRect();
  return imagePoint(client, { x: box.left, y: box.top }, scale);
}

async function openFiles(files: FileList | File[]): Promise<void> {
  if (files.length === 0) return;
  const request = ++loadRequest;
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
  try {
    const next = await loadImage(files[0]);
    if (request !== loadRequest) {
      URL.revokeObjectURL(next.url);
      return;
    }
    finishDrag(true);
    const previous = image;
    image = next;
    rect = initialRect(next);
    imageElement.src = next.url;
    imageElement.alt = next.name;
    if (previous) URL.revokeObjectURL(previous.url);
    element("image-name").textContent = next.name;
    element("image-size").textContent =
      `${next.width.toLocaleString("ja-JP")} × ${next.height.toLocaleString("ja-JP")} px`;
    stage.hidden = false;
    empty.hidden = true;
    fitImage();
    status.textContent =
      "画像を開きました。背景のドラッグで範囲を作成できます。";
  } catch (error) {
    if (request !== loadRequest) return;
    showError(
      error instanceof Error ? error.message : "画像の読み込みに失敗しました。",
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

element("choose-image").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files) void openFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

clear.addEventListener("click", () => {
  ++loadRequest;
  loading = false;
  finishDrag(true);
  if (image) URL.revokeObjectURL(image.url);
  image = null;
  rect = null;
  imageElement.removeAttribute("src");
  imageElement.alt = "";
  stage.hidden = true;
  empty.hidden = false;
  viewport.setAttribute("aria-busy", "false");
  element("image-name").textContent = "画像を選択、または下の領域にドロップ";
  element("image-size").textContent = "すべての座標は画像の原寸ピクセルです";
  for (const input of Object.values(inputs)) {
    input.value = "";
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
  }
  zoomValue.value = "—";
  fit = true;
  fitButton.setAttribute("aria-pressed", "true");
  showError("");
  renderRect();
  status.textContent = "画像をクリアしました。テンプレートは保持しています。";
  element("choose-image").focus();
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

stage.addEventListener("pointerdown", (event) => {
  if (!image || !rect || drag || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  const button = handleFrom(event.target);
  const client = { x: event.clientX, y: event.clientY };
  drag = {
    pointerId: event.pointerId,
    handle: (button?.dataset.handle as Handle | undefined) ?? "draw",
    rect: { ...rect },
    start: pointOnImage(client),
    client,
    moved: false,
  };
  (button ?? viewport).focus({ preventScroll: true });
  stage.setPointerCapture(event.pointerId);
  renderRect();
});

function updateDrag(event: PointerEvent): void {
  if (!drag || !image || event.pointerId !== drag.pointerId) return;
  const client = { x: event.clientX, y: event.clientY };
  const current = pointOnImage(client);
  if (Math.hypot(client.x - drag.client.x, client.y - drag.client.y) >= 3)
    drag.moved = true;
  if (drag.handle === "draw") {
    if (!drag.moved) return;
    rect = drawRect(drag.start, current, image);
  } else {
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
  if (stage.hasPointerCapture(previous.pointerId))
    stage.releasePointerCapture(previous.pointerId);
  renderRect();
  if (fit) fitImage();
  if (cancel) status.textContent = "ドラッグを取り消しました。";
  else announceRect();
}

stage.addEventListener("pointermove", updateDrag);
stage.addEventListener("pointerup", (event) => {
  if (event.pointerId !== drag?.pointerId) return;
  updateDrag(event);
  finishDrag(false);
});
for (const type of ["pointercancel", "lostpointercapture"]) {
  stage.addEventListener(type, (event) => {
    if ((event as PointerEvent).pointerId === drag?.pointerId) finishDrag(true);
  });
}
window.addEventListener("blur", () => finishDrag(true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    finishDrag(true);
  }
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
});
copy.addEventListener("click", async () => {
  const text = output.value;
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "座標をコピーしました。";
  } catch {
    output.focus();
    output.select();
    status.textContent =
      "自動コピーできませんでした。選択された出力をCtrl+C、または⌘Cでコピーしてください。";
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
}).observe(viewport);

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    ++loadRequest;
    if (image) URL.revokeObjectURL(image.url);
  }
});
