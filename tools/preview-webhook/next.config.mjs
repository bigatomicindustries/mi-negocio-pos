import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
export default { turbopack: { root: repo }, outputFileTracingRoot: repo };
