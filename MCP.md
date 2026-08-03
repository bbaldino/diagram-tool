# Homelab Diagram MCP

The diagram app (in `webapp/`) hosts an **MCP server** so an agent (Claude Code / Desktop)
can create and edit diagrams that appear **live** in the app. The same server process serves
the frontend, the API and `/mcp` — no separate process.

## Where it runs

Since 2026-08-03 the app is **deployed**, not run from a working tree: a Komodo stack on the
Proxmox Docker VM (`192.168.1.220:8090`), behind Nginx Proxy Manager at **`diagram.home`**.

**The MCP endpoint is `http://diagram.home/mcp`.** That is what agents should use — it is
always up, and its data is the live diagram data.

`npm run dev` still serves `/mcp` on its own Vite port for local development, but that
instance has its own `DATA_DIR` and is **not** what `diagram.home` serves. Do not register a
dev URL as the everyday MCP: it only works while a dev server happens to be running, and it
edits whatever scratch data that server was pointed at.

To *watch* an agent build a diagram, keep `http://diagram.home` open in a browser.

## Register the MCP with Claude Code

Registered as **`homelab-diagram`** at **user scope** so it's available from every repo on this machine:
```
claude mcp add --transport http --scope user homelab-diagram http://diagram.home/mcp
```
- **Scopes:** `local` (default) = this repo only · `user` = all your repos on this machine ·
  `project` = written to a committed `.mcp.json`, shared with anyone who clones the repo.
- **From another machine:** the same command works anywhere that resolves `diagram.home`.
  If DNS is unavailable, use the VM directly: `http://192.168.1.220:8090/mcp`.
- Verify: `claude mcp list` → `homelab-diagram: … - ✔ Connected`.
- Remove: `claude mcp remove --scope user homelab-diagram`. Change the URL: remove then re-add.
- **Against a local dev server instead** (rare — only when testing MCP changes before release):
  point at the Vite port `npm run dev` prints, e.g.
  `claude mcp add --transport http --scope local homelab-diagram-dev http://localhost:5173/mcp`.
  Use a distinct name and `local` scope so it cannot be mistaken for the deployed one.

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
