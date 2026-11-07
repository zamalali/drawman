// Server-side setup: architecture and grouped diagrams get the compound (ELK) placement. Imported for its side effect by every entry
// point that renders final diagrams (MCP server, CLI). The live view does not import it and stays small.
import { layoutPlaced } from "./compound.js"
import { usePlacer } from "./scene.js"

usePlacer(layoutPlaced)
