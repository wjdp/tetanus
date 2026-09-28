#!/bin/bash
# Start the server; it migrates the database on boot
# Used in the docker container
set -eo pipefail

function motd {
    echo "———————— tetanus server ————————"
    echo "https://github.com/wjdp/tetanus"
    echo "————————————————————————————————"
}

function check_data_directory {
  if [ ! -d "/app/data" ]; then
    echo "🔴❌ Data directory not found. Please mount a volume to /app/data"
    echo "❌🔴 Without a mounted data directory you will lose all data on restart"
    exit 1
  fi
}

function start_server {
  echo "🚀 Starting tetanus server"
  node .output/server/index.mjs
}

motd

check_data_directory

start_server
