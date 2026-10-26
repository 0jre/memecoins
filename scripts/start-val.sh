#!/usr/bin/env bash
export PATH=/root/.local/share/solana/install/active_release/bin:$PATH
rm -rf /root/dl-ledger
nohup solana-test-validator \
  --ledger /root/dl-ledger \
  --reset \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s /root/deps/mpl.so \
  --bpf-program DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb /root/deps/cpmm.so \
  -u devnet \
  --clone 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy \
  --clone 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy \
  > /root/val.log 2>&1 &
echo "started pid $!"
for i in $(seq 1 60); do
  sleep 5
  if curl -s -m2 http://localhost:8899 -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | grep -q result; then
    echo "RPC UP after ${i}x5s"
    break
  fi
done
tail -3 /root/val.log
