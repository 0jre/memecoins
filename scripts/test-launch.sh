#!/usr/bin/env bash
cd /mnt/d/.development/ojulio/projects/blockchain
CLUSTER=devnet RPC_URL=http://localhost:8899 PAYER=/root/.config/solana/id.json \
  DEX=cpmm LP_MODE=burn LIQ_SOL=1 NAME="Test Meme" SYMBOL="TMEME" \
  URI="https://example.com/m.json" \
  timeout 240 npm run launch
echo "EXIT=$?"
