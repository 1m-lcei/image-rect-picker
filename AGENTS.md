# Project context

- When `.codegraph/` exists, use CodeGraph before text searches or file reads to locate or understand code: `codegraph_explore` with this project's path, or `codegraph explore`. Otherwise, or for unindexed content, use file tools.
- A static SPA built with Bun, Vite, TypeScript, and native HTML/CSS. Keep browser runtime dependencies at zero; use Bun and `bun.lock`.
- Images stay in browser memory. No uploads or analytics. Only versioned theme and output-template settings persist in localStorage; omit the template when it matches the default.
- One image and one rectangle. Coordinates are integers in original-image pixels, independent of zoom; width/height are at least 1 and the rectangle stays inside the image. Right/bottom edges are exclusive.
- UI copy is Japanese. The README is concise English documentation for users, focused on features.
- `public/favicon.svg` is the shared icon for the app header, favicon, and README.
- Static assets must work under a subdirectory. Pushes to `main` automatically deploy to GitHub Pages after CI succeeds; manual deployment is also available on `main`.
- `bun run test:browser` checks the built `dist/`; run `bun run build` first. Local tests use generated images and have no production access.
- Commit messages use Conventional Commits: concise English title only, with no body or footers.
