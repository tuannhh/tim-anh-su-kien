#!/bin/sh
# Khoi dong MISA - Tim anh AI.
# Neu co LITESTREAM_BUCKET: khoi phuc DB tu GCS roi chay app kem sao luu lien tuc.
# Neu khong: chay thang node (vd server thuong/local).
set -e
mkdir -p /tmp/data

if [ -n "$LITESTREAM_BUCKET" ]; then
  echo "→ Litestream: khoi phuc DB tu gs://$LITESTREAM_BUCKET/db (neu co)..."
  litestream restore -if-replica-exists /tmp/data/timanh.db || echo "(chua co ban sao - se tao DB moi)"
  echo "→ Chay app kem sao luu lien tuc..."
  exec litestream replicate -exec "node server.js"
else
  exec node server.js
fi
