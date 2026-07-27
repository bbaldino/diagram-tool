# Homelab Diagram MCP

The diagram app (in `webapp/`) hosts an **MCP server** so an agent (Claude Code / Desktop)
can create and edit diagrams that appear **live** in the open app. It's served by the same
dev server — no separate process.

## Prerequisites

1. **Run the app** (this is what serves the MCP):
   ```
   cd webapp && npm run dev
   ```
   The MCP endpoint is then at `http://localhost:5173/mcp` (or `http://192.168.1.21:5173/mcp`
   from another machine on the LAN).
2. To *watch* an agent build a diagram, keep the app open in a browser on the **Diagrams** tab.

## Register the MCP with Claude Code

Registered as **`homelab-diagram`** at **user scope** so it's available from every repo on this machine:
```
claude mcp add --transport http --scope user homelab-diagram http://localhost:5173/mcp
```
- **Scopes:** `local` (default) = this repo only · `user` = all your repos on this machine ·
  `project` = written to a committed `.mcp.json`, shared with anyone who clones the repo.
- **From another machine:** run the same command *there* with the LAN URL —
  `claude mcp add --transport http --scope user homelab-diagram http://192.168.1.21:5173/mcp`
  (`localhost` only works on the box running the app).
- Verify: `claude mcp list` → `homelab-diagram: … - ✔ Connected` (the dev server must be running).
- Remove: `claude mcp remove --scope user homelab-diagram`. Change the URL: remove then re-add.

**MCP servers load at session start**, so **start a fresh `claude` session** (in this repo) to
use the tools. In-session, `/mcp` lists connected servers and their tools.

## Tools

- **Reads:** `list_entities`, `list_diagrams`, `get_diagram`
- **One-shot:** `author_diagram({ name, type?, nodes, edges?, groups?, notes? })`
  - `nodes`: existing entity ids, or `{ new: "Label", icon? }` to create one
  - `edges`: `[from, to, { label?, dir?, color? }?]` tuples (`dir`: `forward|backward|both`)
  - `groups`: `[{ label, members: [entityId…] }]`; `notes`: `{ entityId: "text" }`
  - Creates the diagram, auto-lays it out (flow-directed), applies atomically.
- **Iterate:** `place_entity`, `connect`, `set_edge`, `set_note`, `remove`, `layout`

Agents never supply coordinates — the server lays diagrams out (dagre, left→right). Positions
can be overridden explicitly if wanted.

## Try it (in a fresh session)

> Using the **homelab-diagram** MCP: list the entities, then create a call-flow diagram named
> "Media request" of the path Internet users → Nginx Proxy Manager → Authelia, with NPM going
> to Plex, Sonarr, and Radarr, and the *arr apps grouped as "Media automation" feeding SABnzbd
> and NZBHydra2. Add a note on NPM that it's the reverse proxy + SSO.

The new diagram appears in the app's diagram switcher — select it to watch. Then iterate, e.g.:

> Add Ollama and Open-WebUI, connect NPM → Open-WebUI → Ollama, color that path green, and
> re-run layout.

## Notes

- Everything the agent does streams to the open app over SSE (no reload needed).
- Entities are created/managed in the shared catalog; the agent can create new ones on the fly
  (`{ new: … }`), so keep an eye on the catalog if you care about it staying tidy.
- If the dev server restarts (e.g. after a code change), open tabs re-sync automatically.
