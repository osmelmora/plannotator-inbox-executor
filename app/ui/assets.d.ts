declare module "*.css";

// Explicit browser distribution avoids Mermaid's optional Node UUID entry.
declare module "mermaid/dist/mermaid.esm.min.mjs" {
  import type { Mermaid } from "mermaid";

  const mermaid: Mermaid;
  export default mermaid;
}
