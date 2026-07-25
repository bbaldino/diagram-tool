# Homelab Logical Diagram — Design

**Date:** 2026-07-23
**Status:** In progress — paused pending an Nginx Proxy Manager MCP (see "Open items")

## Goal

A **logical** diagram of the homelab: how components fit together and interact,
grouped by function. NOT a network-topology diagram — the user is not interested
in router/switch/VLAN plumbing, but in the logical topology and interactions
between services and integrations.

## Decisions (locked)

- **Organizing lens:** service groups (logical), not network topology.
- **Detail level:** infrastructure + key integrations. Smart-home devices appear
  as summarized/categorized nodes and notable HA integrations (Frigate, doorbell,
  locks, Rachio, UniFi), NOT all 772 HA entities.
- **Output:** D2 source (`.d2`) committed to this repo + rendered PNG/SVG.
- **Edge convention:** solid = confident interaction, dashed = inferred/assumption
  until confirmed.

## Discovered inventory (from Unraid / Home Assistant / Plex MCPs, 2026-07-23)

### Host
- **Tower** — Unraid OS 7.2.4, kernel 6.12.54. Intel i5-12600K (10c/16t),
  ASRock Z790 Steel Legend WiFi, 4× DDR5 (Team Group UD5-6000). Has an Nvidia GPU
  (used by faster-whisper:gpu, kokoro-gpu, comfyui-nvidia, ollama, piper-nvidia).
  Unraid UI at `192.168.1.42:8080`. No VMs.

### Network (from HA entity names — for reference only, not drawn)
- UniFi stack: UDM Pro Max (gateway), USW Pro Max 24 PoE (switch),
  U6 Mesh (guesthouse) + U6+ (hallway) access points. Subnet `192.168.1.0/24`.

### Docker containers (35 total) — grouped for the diagram

**Media**
- plex (`lscr.io/linuxserver/plex`)
- sonarr, radarr (`linuxserver/*`)
- sabnzbd (`linuxserver/sabnzbd`)
- hydra2 / NZBHydra2 (`linuxserver/nzbhydra2`)
- recyclarr (`ghcr.io/recyclarr/recyclarr`) — exited/on-demand
- HandBrake (`jlesage/handbrake`) — exited/on-demand

**AI / Voice**
- ollama (`ollama/ollama`)
- open-webui (`ghcr.io/open-webui/open-webui`)
- Faster-Whisper-Nvidia (`lscr.io/linuxserver/faster-whisper:gpu`) — STT
- Piper-Nvidia (`ghcr.io/slackr31337/wyoming-piper-gpu`) — TTS
- Kokoro-FastAPI-GPU (`ghcr.io/remsky/kokoro-fastapi-gpu`) — TTS
- ComfyUI-Nvidia-Docker (`mmartial/comfyui-nvidia-docker`) — exited
- wakeword-training (`ghcr.io/bbaldino/wakeword-training`) — custom
- piper-voice-manager (`ghcr.io/bbaldino/piper-voice-manager`) — custom
- tts-pronunciation-proxy (`ghcr.io/bbaldino/tts-pronunciation-proxy`) — custom
- TextyMcSpeechy (`domesticatedviking/textymcspeechy-piper`) — exited

**Home Automation**
- home-assistant (`homeassistant/home-assistant`)
- zwave-js-ui (`zwavejs/zwave-js-ui`)
- mosquitto (`eclipse-mosquitto:2`) — MQTT broker
- music-assistant (`ghcr.io/music-assistant/server`)
- (Frigate NVR — HA integration present; no dedicated container seen in the 35,
  confirm where it runs)

**Infra / Auth**
- Nginx-Proxy-Manager-Official (`jc21/nginx-proxy-manager`)
- Authelia (`authelia/authelia`)
- postgresql15 (`postgres:15`)

**Apps**
- family-dashboard (`ghcr.io/bbaldino/family-dashboard`) — custom
- homelab-health (`ghcr.io/bbaldino/homelab-health`) — custom
- linkding (`sissbruecker/linkding`) — bookmarks
- Mealie (`ghcr.io/mealie-recipes/mealie`) — recipes, exited
- binhex-crafty-4 (`binhex/arch-crafty-4`) — Minecraft server manager
- TREK (`mauriceboe/trek`) — purpose TBD

**MCP bridges** (all `ghcr.io/bbaldino/mcp-bridge`, parameterized per service)
- mcp-arr → Sonarr/Radarr
- mcp-plex → Plex
- mcp-unraid → Unraid API
- cam-proxy (`ghcr.io/bbaldino/cam-proxy`) — camera proxy

### Home Assistant
- 772 entities, 36 domains, 20 areas, HA 2026.7.3 at `hass.home:8123`.
- Notable integrations to show as nodes: Frigate (NVR/cameras), Reolink doorbell,
  Z-Wave locks (Schlage BE468), Rachio irrigation, SleepNumber, robot vacuum,
  UniFi, Denon AVR, cast/media players.

## Interaction map (to draw)

Confident (solid):
- Media: Sonarr/Radarr → NZBHydra2 → SABnzbd → media library → Plex;
  Recyclarr → Sonarr/Radarr.
- Voice: Home Assistant → Whisper (STT) + Piper/Kokoro (TTS) + Ollama (conversation);
  Open-WebUI → Ollama.
- HA hub: Z-Wave JS UI → HA; Mosquitto (MQTT) ↔ HA; Music Assistant ↔ HA;
  Frigate → HA; UniFi → HA.
- Auth edge: Nginx Proxy Manager → Authelia → protected web UIs.
- MCP: You/Claude → mcp-arr → Sonarr/Radarr; → mcp-plex → Plex;
  → mcp-unraid → Unraid; cam-proxy → cameras.

Inferred / to confirm (dashed):
1. Which services sit behind Authelia / Nginx Proxy Manager (auth-gated / exposed).
2. What uses PostgreSQL (Mealie? Authelia? family-dashboard? — Linkding is SQLite).
3. How custom voice tooling (tts-pronunciation-proxy, piper-voice-manager,
   wakeword-training, TextyMcSpeechy) wires into Piper / HA.
4. What TREK and family-dashboard connect to.

## Open items (blocking the first render)

- **User is setting up an Nginx Proxy Manager MCP** to resolve inferred edge #1.
  Ready-made options: b3nw/nginx-proxy-manager-mcp, adamgell/nginx-proxy-manager-mcp,
  VeryBigSad/nginx-proxy-manager-mcp (50 tools). Auth: POST creds to `/api/tokens`
  for a Bearer JWT.
  - Data needed for the diagram: `GET /api/nginx/proxy-hosts` (domain → upstream
    host:port) and the access lists (which hosts are gated).
- Once the NPM MCP is connected: pull proxy hosts + access lists, finalize the
  auth edges, then write the `.d2` and render.

## Next steps on resume

1. Confirm the NPM MCP is connected; call its list-proxy-hosts + access-lists tools.
2. Optionally inspect a few containers (postgres consumers, custom apps) to resolve
   inferred edges #2–#4, or draft with dashes and let the user correct the picture.
3. Write `homelab.d2`, render to PNG/SVG, iterate visually.
