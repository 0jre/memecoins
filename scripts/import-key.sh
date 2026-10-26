#!/usr/bin/env bash
# Import a Phantom private key into /root/hrb.json — paste happens in YOUR
# terminal, hidden. Never echoes, never in argv/env, never leaves the machine.
cd /mnt/d/.development/ojulio/projects/blockchain

read -rsp "paste private key (input hidden, Enter when done): " KEY
echo
if [ -z "$KEY" ]; then echo "empty input — aborting"; exit 1; fi

printf '%s' "$KEY" | node -e '
const bs58 = require("bs58");
const fs = require("fs");
const { Keypair } = require("@solana/web3.js");
const input = fs.readFileSync(0, "utf8").trim();
let bytes;
if (input.startsWith("[")) {
  bytes = Uint8Array.from(JSON.parse(input));
} else {
  bytes = Uint8Array.from(bs58.decode(input));
}
if (bytes.length !== 64) {
  console.error(`expected 64-byte secret key, got ${bytes.length}`);
  process.exit(1);
}
fs.writeFileSync("/root/hrb.json", JSON.stringify([...bytes]));
console.log("pubkey:   " + Keypair.fromSecretKey(bytes).publicKey.toBase58());
' || exit 1
unset KEY

chmod 600 /root/hrb.json
echo "expected: HrbEX7cLgPe7mr6bg726x4emc9bavFBUTHcsJoXBaHTs"
