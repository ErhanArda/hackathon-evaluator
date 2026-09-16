#!/usr/bin/env bash
# Kuyruk izleyici — sitedeki "Değerlendir" butonunu gerçekten otomatik yapar.
#
# Kuyruğu periyodik yoklar; bekleyen bir request görünce Claude Code'u headless
# modda çalıştırıp /process-queue'yu koşturur. Sen sadece /admin'den takımı
# ekleyip butona basıyorsun; gerisi kendiliğinden oluyor.
#
# Kullanım:
#   ./scripts/watch-queue.sh                       # varsayılan: 10 sn aralık
#   INTERVAL=5 ./scripts/watch-queue.sh            # daha sık yokla
#   BASE=http://localhost:3000 ./scripts/watch-queue.sh
#
# Durdurmak: Ctrl-C
#
# NOT — izinler: Claude Code headless modda izin soramaz, o yüzden
# --permission-mode bypassPermissions ile koşar. Değerlendirilen repo'nun kodu
# ÇALIŞTIRILMAZ: agent prompt'larındaki komut politikası install/run/docker'ı
# yasaklıyor ve yalnız salt-okuma komutlarına izin veriyor. Yine de yalnız
# güvendiğin repoları kuyruğa al.

set -uo pipefail

BASE="${BASE:-${EVALUATOR_API_BASE:-https://hackathon-evaluator-eta.vercel.app}}"
INTERVAL="${INTERVAL:-10}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/.watch-logs"
mkdir -p "$LOG_DIR"

# .env.local varsa yükle (EVALUATOR_API_BASE, INGEST_TOKEN)
if [ -f "$PROJECT_DIR/apps/web/.env.local" ]; then
  set -a; . "$PROJECT_DIR/apps/web/.env.local"; set +a
  BASE="${BASE:-$EVALUATOR_API_BASE}"
fi

command -v claude >/dev/null || { echo "claude CLI bulunamadı (PATH)"; exit 127; }

ts() { date +"%H:%M:%S"; }
log() { printf "[%s] %s\n" "$(ts)" "$*"; }

running=0
trap 'echo; log "durduruluyor..."; exit 0' INT TERM

log "izleniyor: $BASE  (aralık ${INTERVAL}s, log: $LOG_DIR)"
log "Ctrl-C ile durdur. /admin'den takım ekleyip Değerlendir'e basman yeterli."

while true; do
  # Bekleyen sayısını al. Ağ hatasında sessizce bir sonraki tura geç.
  pending="$(curl -fsS --max-time 15 "$BASE/api/eval-requests?status=pending&limit=20" 2>/dev/null \
    | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("requests",[])))' 2>/dev/null)"

  if [ -z "${pending:-}" ]; then
    log "kuyruk okunamadı (ağ?) — ${INTERVAL}s sonra tekrar"
    sleep "$INTERVAL"
    continue
  fi

  if [ "$pending" -gt 0 ] && [ "$running" -eq 0 ]; then
    running=1
    stamp="$(date +%Y%m%d-%H%M%S)"
    out="$LOG_DIR/run-$stamp.log"
    log "$pending bekleyen request — /process-queue başlatılıyor (log: $(basename "$out"))"
    start=$(date +%s)
    (
      cd "$PROJECT_DIR" || exit 1
      claude -p "/process-queue base=$BASE" --permission-mode bypassPermissions
    ) >"$out" 2>&1
    rc=$?
    dur=$(( $(date +%s) - start ))
    if [ $rc -eq 0 ]; then
      log "bitti (${dur}s) — $(tail -3 "$out" | tr '\n' ' ' | cut -c1-140)"
    else
      log "HATA exit=$rc (${dur}s) — ayrıntı: $out"
    fi
    running=0
  fi

  sleep "$INTERVAL"
done
