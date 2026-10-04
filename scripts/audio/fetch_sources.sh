#!/usr/bin/env bash
# Download the Kenney CC0 packs used by the hybrid cues (impact, door_slam, footsteps_sneak).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p sources; cd sources
curl -sLO https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip
curl -sLO https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip
for z in *.zip; do unzip -oq "$z" -d "${z%.zip}"; done
sha256sum *.zip
