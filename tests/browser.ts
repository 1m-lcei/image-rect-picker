import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, firefox, type Page, webkit } from "playwright";
import { preview } from "vite";

await mkdir("test-results", { recursive: true });
const server = await preview({
  preview: { host: "127.0.0.1", port: 0, open: false },
});
const address = server.httpServer.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const engines = process.argv.includes("--edge")
  ? ([["edge", chromium]] as const)
  : ([
      ["chromium", chromium],
      ["firefox", firefox],
      ["webkit", webkit],
    ] as const);

async function imageFile(
  page: Page,
  width = 640,
  height = 480,
  mimeType = "image/png",
) {
  const data = await page.evaluate(
    ({ width, height, mimeType }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#dce9e5";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#30665c";
      context.fillRect(width / 8, height / 8, width / 3, height / 2);
      context.fillStyle = "#f3bb6d";
      context.beginPath();
      context.arc(
        width * 0.7,
        height * 0.5,
        Math.min(width, height) / 4,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.fillStyle = "#24443d";
      context.font = "24px sans-serif";
      context.fillText("Image Rect Picker", 24, height - 24);
      return canvas.toDataURL(mimeType).split(",")[1] ?? "";
    },
    { width, height, mimeType },
  );
  return {
    name: `sample.${mimeType.split("/")[1]}`,
    mimeType,
    buffer: Buffer.from(data, "base64"),
  };
}

async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.getElementById("viewport")?.getAttribute("aria-busy") ===
      "false",
  );
}

async function values(page: Page): Promise<number[]> {
  return page
    .locator("#coordinates input")
    .evaluateAll((nodes) =>
      nodes.map((node) => Number((node as HTMLInputElement).value)),
    );
}

async function setValues(page: Page, values: number[]): Promise<void> {
  for (const [i, field] of ["x", "y", "width", "height"].entries()) {
    await page.locator(`#${field}`).fill(String(values[i]));
    await page.locator(`#${field}`).press("Enter");
  }
}

async function dragImage(
  page: Page,
  from: number[],
  to: number[],
): Promise<void> {
  const box = await page.locator("#stage").boundingBox();
  assert(box);
  // WebKit sends integer pointer coordinates; target the nearest CSS pixel.
  await page.mouse.move(
    Math.round(box.x + (from[0] ?? 0)),
    Math.round(box.y + (from[1] ?? 0)),
  );
  await page.mouse.down();
  await page.mouse.move(
    Math.round(box.x + (to[0] ?? 0)),
    Math.round(box.y + (to[1] ?? 0)),
    { steps: 5 },
  );
  await page.mouse.up();
}

let failed = false;
try {
  for (const [name, engine] of engines) {
    const browser = await engine
      .launch(name === "edge" ? { channel: "msedge" } : {})
      .catch((error: unknown) => {
        failed = true;
        console.error(`FAIL ${name}: browser could not start`, error);
        return null;
      });
    if (!browser) continue;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
      locale: "ja-JP",
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const active = new Set<string>();
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        active.add(url);
        document.documentElement.dataset.objectUrls = String(active.size);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        revoke(url);
        active.delete(url);
        document.documentElement.dataset.objectUrls = String(active.size);
      };
    });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(origin))
        external.push(request.url());
    });
    try {
      // Native controls and CSS remain usable without script or anchor support.
      const nativePage = await browser.newPage({
        javaScriptEnabled: false,
        viewport: { width: 390, height: 844 },
        colorScheme: "dark",
      });
      await nativePage.route("**/*.css", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replaceAll(
            "anchor(",
            "unsupported-anchor(",
          ),
        });
      });
      await nativePage.goto(origin);
      await nativePage.locator("#menu-trigger").click();
      const fallbackBox = await nativePage
        .locator("#header-menu")
        .boundingBox();
      assert(fallbackBox && fallbackBox.x >= 0 && fallbackBox.y >= 0);
      assert(fallbackBox.x + fallbackBox.width <= 390);
      assert(fallbackBox.y + fallbackBox.height <= 844);
      for (const preference of ["light", "dark", "system"]) {
        await nativePage
          .locator(`input[name="theme"][value="${preference}"]`)
          .check();
        assert.equal(
          await nativePage
            .locator("html")
            .evaluate((node) => getComputedStyle(node).colorScheme),
          preference === "system" ? "light dark" : preference,
        );
      }
      await nativePage.keyboard.press("Escape");
      await nativePage.locator("#help-trigger").click();
      await nativePage.getByRole("button", { name: "閉じる" }).click();
      assert(await nativePage.locator("#help-dialog").isHidden());
      await nativePage.close();

      await page.goto(origin);
      const menuTrigger = page.locator("#menu-trigger");
      const menu = page.locator("#header-menu");
      const themeToggle = page.locator("#theme-toggle");
      const checkTheme = async (preference: string, target: "sun" | "moon") => {
        await page.waitForFunction((target) => {
          const icon = document.querySelector(`#theme-toggle .${target}`);
          return icon && getComputedStyle(icon).display !== "none";
        }, target);
        assert(
          await themeToggle
            .locator(target === "sun" ? ".moon" : ".sun")
            .isHidden(),
        );
        assert.equal(
          await themeToggle.getAttribute("aria-label"),
          "テーマの切り替え",
        );
        assert.equal(
          await page
            .locator("html")
            .evaluate((node) => getComputedStyle(node).colorScheme),
          preference === "system" ? "light dark" : preference,
        );
        assert.equal(
          await page.locator('input[name="theme"]:checked').inputValue(),
          preference,
        );
      };
      await checkTheme("system", "moon");
      await themeToggle.click();
      await checkTheme("dark", "sun");
      await page.emulateMedia({ colorScheme: "dark" });
      await checkTheme("dark", "sun");
      await themeToggle.click();
      await checkTheme("light", "moon");
      await themeToggle.click();
      await checkTheme("system", "sun");
      await page.emulateMedia({ colorScheme: "light" });
      await checkTheme("system", "moon");
      await themeToggle.press("Space");
      await checkTheme("dark", "sun");
      await themeToggle.press("Space");
      await checkTheme("system", "moon");
      await menuTrigger.click();
      await page.getByRole("radio", { name: "ライト", exact: true }).check();
      await checkTheme("light", "moon");
      await page.emulateMedia({ colorScheme: "dark" });
      await checkTheme("light", "moon");
      await page.getByRole("radio", { name: "ダーク", exact: true }).check();
      await checkTheme("dark", "sun");
      await page
        .getByRole("radio", { name: "ダーク", exact: true })
        .press("ArrowLeft");
      await checkTheme("light", "moon");
      await page.getByRole("radio", { name: "システム" }).check();
      await checkTheme("system", "sun");
      await page.emulateMedia({ colorScheme: "light" });
      await checkTheme("system", "moon");
      await page.keyboard.press("Escape");
      assert(await menu.isHidden());
      await menuTrigger.press("Enter");
      await page.keyboard.press("Tab");
      assert(
        await page
          .getByRole("radio", { name: "システム" })
          .evaluate((node) => node === document.activeElement),
      );
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      const about = page.locator("#about-dialog");
      assert(await about.evaluate((node) => node.matches(":modal")));
      assert(await menu.isHidden());
      await page.locator("#template").evaluate((node) => node.focus());
      assert(
        await about.evaluate((node) => node.contains(document.activeElement)),
      );
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        assert(
          await about.evaluate(
            (node) =>
              node.contains(document.activeElement) ||
              document.activeElement === document.body,
          ),
        );
      }
      assert.equal(
        await about.locator("a").getAttribute("href"),
        "https://x.com/1m_lcei",
      );
      assert.equal(
        await about.locator(".link-placeholder").getAttribute("href"),
        null,
      );
      await page.screenshot({ path: `test-results/${name}-about.png` });
      await page.keyboard.press("Escape");
      assert(await about.isHidden());
      await page.waitForFunction(
        () => document.activeElement?.id === "menu-trigger",
      );
      const helpTrigger = page.locator("#help-trigger");
      const help = page.locator("#help-dialog");
      await helpTrigger.press("Space");
      assert(await help.evaluate((node) => node.matches(":modal")));
      const helpBox = await help.boundingBox();
      assert(helpBox);
      await page.mouse.click(helpBox.x + 4, helpBox.y + 4);
      assert(await help.isVisible());
      await page.mouse.click(1, 1);
      if (!(await help.evaluate((node) => "closedBy" in node))) {
        assert(await help.isVisible());
        await page.keyboard.press("Escape");
      }
      assert(await help.isHidden());
      await page.waitForFunction(
        () => document.activeElement?.id === "help-trigger",
      );
      await helpTrigger.click();
      await help.getByRole("button", { name: "閉じる" }).click();
      assert(await help.isHidden());
      assert(await page.locator("#empty").isVisible());
      assert(await page.locator("#copy").isDisabled());
      const file = await imageFile(page);
      let fileChoosers = 0;
      page.on("filechooser", () => fileChoosers++);
      await page.locator("#file").focus();
      const chooser = page.waitForEvent("filechooser");
      await page.keyboard.press("Enter");
      await (await chooser).setFiles(file);
      await loaded(page);
      // The whole file panel opens the picker, except its clear button.
      for (const target of [
        ".file-panel",
        "#choose-image svg",
        "#image-name",
        "#image-size",
        "#file-hint",
      ]) {
        const box = await page.locator(target).boundingBox();
        assert(box);
        const picker = page.waitForEvent("filechooser");
        await page.mouse.click(box.x + 3, box.y + box.height / 2);
        await (await picker).setFiles(file);
        await loaded(page);
      }
      assert.equal(fileChoosers, 6);
      await page.locator("#clear svg").click();
      assert(await page.locator("#empty").isVisible());
      assert(
        await page
          .locator("#file")
          .evaluate((node) => node === document.activeElement),
      );
      const clearBox = await page.locator("#clear").boundingBox();
      assert(clearBox);
      await page.mouse.click(
        clearBox.x + clearBox.width / 2,
        clearBox.y + clearBox.height / 2,
      );
      assert.equal(fileChoosers, 6);
      await page.locator("#file").setInputFiles(file);
      await loaded(page);
      assert.deepEqual(await values(page), [160, 120, 320, 240]);
      assert.equal(
        await page.locator("#output").inputValue(),
        "320x240+160+120",
      );
      await page.locator("#actual-size").click();

      await setValues(page, [40, 30, 200, 120]);
      await page.locator("#move").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowDown");
      assert.deepEqual(await values(page), [41, 40, 200, 120]);
      for (const [handle, key] of [
        ["n", "ArrowDown"],
        ["s", "ArrowDown"],
        ["w", "ArrowRight"],
        ["e", "ArrowRight"],
      ]) {
        await page.locator(`[data-handle="${handle}"]`).focus();
        await page.keyboard.press(key ?? "");
      }
      assert.deepEqual(await values(page), [42, 41, 200, 120]);
      await page.locator("#x").fill("1.5");
      await page.locator("#x").press("Enter");
      assert(await page.locator("#error").isVisible());
      assert.equal(await page.locator("#output").inputValue(), "200x120+42+41");
      await page.locator("#x").fill("42");
      await page.locator("#x").press("Enter");

      await dragImage(page, [10, 10], [110, 90]);
      assert.deepEqual(await values(page), [10, 10, 100, 80]);
      await dragImage(page, [220, 160], [150, 110]);
      assert.deepEqual(await values(page), [150, 110, 70, 50]);
      await dragImage(page, [30, 30], [30, 30]);
      assert.deepEqual(await values(page), [150, 110, 70, 50]);
      await dragImage(page, [180, 135], [200, 145]);
      assert.deepEqual(await values(page), [170, 120, 70, 50]);
      await dragImage(page, [170, 145], [190, 145]);
      assert.deepEqual(await values(page), [190, 120, 50, 50]);

      // Real pointer capture, followed by cancellation and Escape.
      for (const cancel of ["pointercancel", "Escape"]) {
        const before = await values(page);
        await page.locator("#stage").evaluate((node) => {
          node.addEventListener(
            "pointerdown",
            (event) => {
              (node as HTMLElement).dataset.pointer = String(
                (event as PointerEvent).pointerId,
              );
            },
            { once: true },
          );
        });
        const box = await page.locator("#move").boundingBox();
        assert(box);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 30,
          box.y + box.height / 2 + 15,
        );
        if (cancel === "Escape") await page.keyboard.press("Escape");
        else
          await page.locator("#stage").evaluate((node) =>
            node.dispatchEvent(
              new PointerEvent("pointercancel", {
                pointerId: Number((node as HTMLElement).dataset.pointer),
                bubbles: true,
              }),
            ),
          );
        await page.mouse.up();
        assert.deepEqual(await values(page), before);
      }

      await page
        .locator("#template")
        .fill("{x},{y},{width},{height},{x2},{y2},{x},<b>{unknown}</b>");
      assert.equal(
        await page.locator("#output").inputValue(),
        "190,120,50,50,240,170,190,<b>{unknown}</b>",
      );
      assert.equal(await page.locator("b").count(), 0);
      // Test both clipboard outcomes without OS clipboard permissions.
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              document.body.dataset.copied = text;
            },
          },
        });
      });
      await page.locator("#copy").click();
      await page.waitForFunction(
        () => document.body.dataset.copied !== undefined,
      );
      assert.equal(
        await page.locator("body").getAttribute("data-copied"),
        await page.locator("#output").inputValue(),
      );
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async () => {
              throw new Error("Denied");
            },
          },
        });
      });
      await page.locator("#copy").click();
      await page.waitForFunction(() => document.activeElement?.id === "output");
      assert.equal(
        await page
          .locator("#output")
          .evaluate((node) => (node as HTMLInputElement).selectionEnd),
        (await page.locator("#output").inputValue()).length,
      );

      for (const invalid of [
        {
          name: "bad.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        },
        {
          name: "broken.png",
          mimeType: "image/png",
          buffer: Buffer.from("broken"),
        },
        {
          name: "disguised.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
          ),
        },
        {
          name: "oversize.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
        },
      ]) {
        await page.locator("#file").setInputFiles(invalid);
        await loaded(page);
        assert(await page.locator("#error").isVisible());
        assert.deepEqual(await values(page), [190, 120, 50, 50]);
        assert.equal(
          await page.locator("html").getAttribute("data-object-urls"),
          "1",
        );
      }

      if (name === "chromium") {
        await page
          .locator("#file")
          .setInputFiles(await imageFile(page, 10000, 5001));
        await loaded(page);
        assert.match(
          await page.locator("#error-text").innerText(),
          /50メガピクセル/,
        );
        assert.deepEqual(await values(page), [190, 120, 50, 50]);
        assert.equal(
          await page.locator("html").getAttribute("data-object-urls"),
          "1",
        );
      }

      // JPEG/WebP/GIF/BMP decode through the same loader.
      const bmp = Buffer.alloc(58);
      bmp.write("BM");
      bmp.writeUInt32LE(58, 2);
      bmp.writeUInt32LE(54, 10);
      bmp.writeUInt32LE(40, 14);
      bmp.writeInt32LE(1, 18);
      bmp.writeInt32LE(1, 22);
      bmp.writeUInt16LE(1, 26);
      bmp.writeUInt16LE(24, 28);
      for (const supported of [
        await imageFile(page, 32, 24, "image/jpeg"),
        await imageFile(page, 32, 24, "image/webp"),
        {
          name: "tiny.gif",
          mimeType: "image/gif",
          buffer: Buffer.from(
            "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            "base64",
          ),
        },
        { name: "tiny.bmp", mimeType: "image/bmp", buffer: bmp },
      ]) {
        await page.locator("#file").setInputFiles(supported);
        await loaded(page);
        assert.equal(await page.locator("#error").isVisible(), false);
        assert.equal(
          await page.locator("#image-name").textContent(),
          supported.name,
        );
      }
      assert.deepEqual(await values(page), [0, 0, 1, 1]);

      await page.locator("#file").setInputFiles(file);
      await loaded(page);
      await page.locator("#file").setInputFiles(file);
      await loaded(page);
      assert.deepEqual(await values(page), [160, 120, 320, 240]);
      const drop = async (count: number) => {
        await page.locator("#viewport").evaluate(
          (node, { base64, count }) => {
            const bytes = Uint8Array.from(atob(base64), (character) =>
              character.charCodeAt(0),
            );
            const transfer = new DataTransfer();
            for (let i = 0; i < count; i++)
              transfer.items.add(
                new File([bytes], "drop.png", { type: "image/png" }),
              );
            node.dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
              }),
            );
          },
          { base64: file.buffer.toString("base64"), count },
        );
        await loaded(page);
      };
      await drop(2);
      assert(await page.locator("#error").isVisible());
      await drop(1);
      assert.equal(await page.locator("#image-name").textContent(), "drop.png");

      // Hold decodes to deterministically reverse the order of two loads.
      await page.evaluate(() => {
        const decode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () {
          const ready = decode.call(this);
          return new Promise<void>((resolve, reject) => {
            const release = document.createElement("button");
            release.className = "release-decode";
            release.onclick = () => {
              ready.then(resolve, reject);
              release.remove();
            };
            document.body.append(release);
          });
        };
      });
      await page.locator("#file").setInputFiles({ ...file, name: "old.png" });
      await page.locator(".release-decode").waitFor({ state: "attached" });
      await page.locator("#file").setInputFiles({ ...file, name: "new.png" });
      await page
        .locator(".release-decode")
        .nth(1)
        .waitFor({ state: "attached" });
      await page
        .locator(".release-decode")
        .nth(1)
        .evaluate((node) => (node as HTMLButtonElement).click());
      await loaded(page);
      await page
        .locator(".release-decode")
        .evaluate((node) => (node as HTMLButtonElement).click());
      await page.waitForFunction(
        () => document.documentElement.dataset.objectUrls === "1",
      );
      assert.equal(await page.locator("#image-name").textContent(), "new.png");
      await page
        .locator("#file")
        .setInputFiles({ ...file, name: "cancelled.png" });
      await page.locator(".release-decode").waitFor({ state: "attached" });
      await page.locator("#clear").click();
      await page
        .locator(".release-decode")
        .evaluate((node) => (node as HTMLButtonElement).click());
      await page.waitForFunction(
        () => document.documentElement.dataset.objectUrls === "0",
      );
      assert(await page.locator("#empty").isVisible());
      assert.equal(
        await page.locator("#template").inputValue(),
        "{x},{y},{width},{height},{x2},{y2},{x},<b>{unknown}</b>",
      );
      await page.reload();

      // Large image: scrolling and zooming must not change original coordinates.
      const large = await imageFile(page, 2400, 1800);
      await page.locator("#file").setInputFiles(large);
      await loaded(page);
      await page.locator("#actual-size").click();
      await setValues(page, [300, 250, 400, 300]);
      await page.locator("#viewport").evaluate((node) => {
        node.scrollLeft = 200;
        node.scrollTop = 150;
      });
      const beforeZoom = await values(page);
      const workspace = await page.locator("#viewport").boundingBox();
      assert(workspace);
      const anchor = { x: workspace.x + 300, y: workspace.y + 200 };
      const beforeBox = await page.locator("#stage").boundingBox();
      assert(beforeBox);
      await page.mouse.move(anchor.x, anchor.y);
      await page.mouse.wheel(0, -100);
      await page.waitForFunction(
        () => document.getElementById("zoom-value")?.textContent === "110%",
      );
      assert.deepEqual(await values(page), beforeZoom);
      const afterBox = await page.locator("#stage").boundingBox();
      assert(afterBox);
      assert(
        Math.abs((anchor.x - afterBox.x) / 1.1 - (anchor.x - beforeBox.x)) < 1,
      );
      assert(
        Math.abs((anchor.y - afterBox.y) / 1.1 - (anchor.y - beforeBox.y)) < 1,
      );
      await dragImage(page, [350 * 1.1, 300 * 1.1], [370 * 1.1, 310 * 1.1]);
      assert.deepEqual(await values(page), [320, 260, 400, 300]);
      const zoomText = await page.locator("#zoom-value").textContent();
      await page
        .locator("#viewport")
        .dispatchEvent("wheel", { deltaY: -100, ctrlKey: true });
      assert.equal(await page.locator("#zoom-value").textContent(), zoomText);

      await page.locator("#actual-size").click();
      const panStart = { x: workspace.x + 300, y: workspace.y + 200 };
      const panRect = await values(page);
      for (const mode of ["space", "middle", "button"]) {
        await page.locator("#viewport").evaluate((node) => {
          node.scrollLeft = 200;
          node.scrollTop = 150;
        });
        if (mode === "button") await page.locator("#pan").click();
        await page.locator("#viewport").focus();
        await page.mouse.move(panStart.x, panStart.y);
        if (mode === "space") await page.keyboard.down("Space");
        const button = mode === "middle" ? "middle" : "left";
        await page.mouse.down({ button });
        await page.mouse.move(panStart.x - 80, panStart.y - 60, { steps: 4 });
        await page.mouse.up({ button });
        if (mode === "space") await page.keyboard.up("Space");
        assert.deepEqual(
          await page
            .locator("#viewport")
            .evaluate((node) => [node.scrollLeft, node.scrollTop]),
          [280, 210],
        );
        assert.deepEqual(await values(page), panRect);
        assert.equal(await page.locator("#zoom-value").textContent(), "100%");
        if (mode === "button") await page.locator("#pan").click();
      }
      await page.locator("#viewport").focus();
      await page.mouse.move(panStart.x, panStart.y);
      await page.keyboard.down("Space");
      await page.mouse.down();
      await page.mouse.move(panStart.x - 30, panStart.y - 20);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Space");
      assert.deepEqual(
        await page
          .locator("#viewport")
          .evaluate((node) => [node.scrollLeft, node.scrollTop]),
        [280, 210],
      );
      assert.deepEqual(await values(page), panRect);
      await page.locator("#template").press("End");
      await page.locator("#template").press("Space");
      assert((await page.locator("#template").inputValue()).endsWith(" "));
      assert.equal(
        await page
          .locator("#viewport")
          .evaluate((node) => node.classList.contains("pan-ready")),
        false,
      );
      await page.locator("#template").fill("{width}x{height}+{x}+{y}");

      // Zoomed edges extend offscreen; their handles must remain usable.
      await setValues(page, [300, 100, 400, 1500]);
      await page.locator("#viewport").evaluate((node) => {
        node.scrollLeft = 200;
        node.scrollTop = 300;
      });
      await page.waitForFunction(() => {
        const handle = document.querySelector(".west")?.getBoundingClientRect();
        const viewport = document.getElementById("viewport");
        if (!handle || !viewport) return false;
        const frame = viewport.getBoundingClientRect();
        return (
          Math.abs(
            handle.top +
              handle.height / 2 -
              (frame.top + viewport.clientTop + viewport.clientHeight / 2),
          ) < 1
        );
      });
      assert(await page.locator(".north").isHidden());
      assert(await page.locator(".south").isHidden());
      const west = await page.locator(".west").boundingBox();
      assert(west);
      await page.mouse.move(west.x + west.width / 2, west.y + west.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        west.x + west.width / 2 + 40,
        west.y + west.height / 2,
      );
      await page.mouse.up();
      assert.deepEqual(await values(page), [340, 100, 360, 1500]);
      await setValues(page, [100, 100, 2000, 200]);
      await page.locator("#viewport").evaluate((node) => {
        node.scrollLeft = 500;
        node.scrollTop = 0;
      });
      await page.waitForFunction(() => {
        const handle = document
          .querySelector(".north")
          ?.getBoundingClientRect();
        const viewport = document.getElementById("viewport");
        if (!handle || !viewport) return false;
        const frame = viewport.getBoundingClientRect();
        return (
          Math.abs(
            handle.left +
              handle.width / 2 -
              (frame.left + viewport.clientLeft + viewport.clientWidth / 2),
          ) < 1
        );
      });
      assert(await page.locator(".west").isHidden());
      assert(await page.locator(".east").isHidden());
      await page.locator("#fit").click();
      await page.screenshot({
        path: `test-results/${name}-desktop.png`,
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#file").setInputFiles({
        ...file,
        name: `${"非常に長いファイル名".repeat(12)}.png`,
      });
      await loaded(page);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page.locator("#actual-size").tap();
      await page.locator("#fit").tap();
      await page.screenshot({
        path: `test-results/${name}-mobile-dark.png`,
        fullPage: true,
      });
      await menuTrigger.tap();
      const menuBox = await menu.boundingBox();
      assert(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
      await page.screenshot({ path: `test-results/${name}-mobile-menu.png` });
      await page.locator("#about-trigger").tap();
      await about.getByRole("button", { name: "閉じる" }).tap();
      await helpTrigger.tap();
      const mobileHelpBox = await help.boundingBox();
      assert(
        mobileHelpBox &&
          mobileHelpBox.x >= 0 &&
          mobileHelpBox.x + mobileHelpBox.width <= 390,
      );
      await page.screenshot({ path: `test-results/${name}-mobile-help.png` });
      await help.getByRole("button", { name: "閉じる" }).tap();

      if (name === "chromium" || name === "edge") {
        const session = await context.newCDPSession(page);
        await page.locator("#viewport").scrollIntoViewIfNeeded();
        const bounds = await page.locator("#move").boundingBox();
        assert(bounds);
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        const before = await values(page);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + 10, y: y + 10 }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        const after = await values(page);
        assert((after[0] ?? 0) > (before[0] ?? 0));
        assert((after[1] ?? 0) > (before[1] ?? 0));

        await page.locator("#actual-size").tap();
        await page.locator("#pan").tap();
        await page.locator("#viewport").scrollIntoViewIfNeeded();
        await page.locator("#viewport").evaluate((node) => {
          node.scrollLeft = 100;
          node.scrollTop = 60;
        });
        const touchFrame = await page.locator("#viewport").boundingBox();
        assert(touchFrame);
        const touch = { x: touchFrame.x + 140, y: touchFrame.y + 100 };
        const beforePan = await values(page);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [touch],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: touch.x - 50, y: touch.y - 40 }],
        });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        assert.deepEqual(
          await page
            .locator("#viewport")
            .evaluate((node) => [node.scrollLeft, node.scrollTop]),
          [150, 100],
        );
        assert.deepEqual(await values(page), beforePan);
        await page.locator("#pan").tap();
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      console.log(
        `PASS ${name}: image loading, selection, cancellation, keyboard, zoom, pan, visible handles, theme, menus, dialogs, clipboard, responsive layout`,
      );
    } catch (error) {
      failed = true;
      await page
        .screenshot({
          path: `test-results/${name}-failure.png`,
          fullPage: true,
        })
        .catch(() => {});
      console.error(`FAIL ${name}`, error);
    } finally {
      await browser.close();
    }
  }

  const nested = await preview({
    base: "/nested/",
    preview: { host: "127.0.0.1", port: 0, open: false },
  });
  const nestedAddress = nested.httpServer.address();
  assert(nestedAddress && typeof nestedAddress !== "string");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${nestedAddress.port}/nested/`);
    await page.locator("#file").setInputFiles(await imageFile(page, 1, 1));
    await loaded(page);
    assert.equal(await page.locator("#output").inputValue(), "1x1+0+0");
    console.log("PASS subdirectory deployment");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) =>
      nested.httpServer.close(() => resolve()),
    );
  }
} finally {
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}
if (failed) process.exitCode = 1;
