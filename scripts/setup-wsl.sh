#!/usr/bin/env bash
# One-time Solana toolchain setup inside WSL Ubuntu (run as root or with sudo).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== apt deps ==="
apt-get update -qq
apt-get install -y -qq build-essential pkg-config libssl-dev curl

echo "=== rust ==="
if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  export PATH="$HOME/.cargo/bin:$PATH"
fi
cargo --version

echo "=== solana CLI (agave) ==="
if ! command -v solana >/dev/null; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
solana --version

echo "=== anchor via avm ==="
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
fi
avm install 0.30.1
avm use 0.30.1
anchor --version

echo "=== done ==="
