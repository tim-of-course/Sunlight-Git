import { readFile, writeFile } from "node:fs/promises";
import { renderAsync } from "@resvg/resvg-js";

const svg = await readFile(new URL("../src/assets/logo.svg", import.meta.url));
const png = await renderAsync(svg, {
  background: "rgba(0,0,0,0)",
  fitTo: { mode: "width", value: 1024 }
});
await writeFile(new URL("../src-tauri/app-icon.png", import.meta.url), png.asPng());
