#!/usr/bin/env bash
# Localnet with real programs: Metaplex mpl, Raydium CPMM (devnet),
# Orca Whirlpool (mainnet .so + mainnet config/ext/fee-tier via --account),
# Meteora DLMM (devnet).
export PATH=/root/.local/share/solana/install/active_release/bin:$PATH
rm -rf /root/dl-ledger
exec solana-test-validator \
  --ledger /root/dl-ledger \
  --reset \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s /root/deps/mpl.so \
  --bpf-program DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb /root/deps/cpmm.so \
  --bpf-program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc /root/deps/whirlpool.so \
  --bpf-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo /root/deps/dlmm.so \
  --bpf-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN /root/deps/dbc.so \
  --account 2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ /root/deps/wh-cfg.json \
  --account 777H5H3Tp9U11uRVRzFwM8BinfiakbaLT8vQpeuhvEiH /root/deps/wh-ext.json \
  --account HT55NVGVTjWmWLjV7BrSMPVZ7ppU8T2xE5nCAZ6YaGad /root/deps/wh-ft64.json \
  -u devnet \
  --clone 3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy \
  --clone 5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy
