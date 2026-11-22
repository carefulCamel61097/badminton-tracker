#!/bin/sh
# Every harvest, in the order they have to run in.
#
#   sh tools/harvest-all.sh
#
# ⚠️⚠️ The order is not a style choice. `harvest-winners.mjs` writes the titles
# and `harvest-calendar.mjs` writes the calendar those titles are a *share* of,
# so the calendar has to be able to see a season the winners harvest has just
# created — in January that season does not exist until the first title lands.
# Podiums are independent and go first because they are the slowest.
#
# ⚠️ Each tool resumes from what is on disk, so a finished season costs zero
# requests and only the season being played is re-asked. Measured 22 Nov 2026:
# ~110 podium calls, 19 per discipline, 21 calendar calls — about four minutes
# for the lot.
#
# ⚠️ A failing tool does not stop the others: what the later ones collect is
# still worth having, and `tools/verify-harvest.mjs` is what guarantees nothing
# was lost. The exit code is non-zero if anything failed, so a caller can shout
# after the good data is safely in.
set -u
cd "$(dirname "$0")/.." || exit 1

failed=''
run() {
  echo ""
  echo "===== $* ====="
  if ! "$@"; then
    echo "FAILED: $*"
    failed="${failed} [$*]"
  fi
}

run node tools/harvest-podiums.mjs
for d in 1 2 3 4 5; do
  run node tools/harvest-winners.mjs --draw "$d"
done
run node tools/harvest-calendar.mjs

echo ""
if [ -n "${failed}" ]; then
  echo "one or more harvests failed:${failed}"
  exit 1
fi
echo "all harvests finished"
