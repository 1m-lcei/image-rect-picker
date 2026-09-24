import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { modulePreload: { polyfill: false } },
  plugins: [
    {
      name: "strip-html-comments",
      apply: "build",
      transformIndexHtml(html) {
        return html
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/^[ \t]*\r?\n/gm, "");
      },
    },
  ],
});
