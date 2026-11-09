#!/usr/bin/env bash
# Build one or both GridAnonymizer editions from source (Linux and macOS).
# Same options as build.ps1.
#
#   ./build.sh                    both editions (default)
#   ./build.sh dotnet --native    .NET only, as a standalone native executable
#   ./build.sh web --test         TypeScript only, then its tests
#   ./build.sh --test --run       both, all tests, then start gridanon ui
#
# Targets: both | dotnet | web
#   web     npm ci (when needed), then the hosted page, the offline page
#           (web/dist/gridanon-web.html) and the Node CLI
#   dotnet  gridanon in dotnet/out
#   both    web first, then refresh the page embedded in `gridanon ui` from it,
#           then .NET, so both run the same UI
# Options:
#   --native  .NET: native executable (needs clang + zlib1g-dev on Linux,
#             Xcode command-line tools on macOS) instead of a portable build
#   --test    run each built edition's tests afterwards
#   --run     start the UI afterwards: gridanon ui, or the page server (web only)
#
# Works with the bash 3.2 that ships with macOS.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$root/web"
dotnet_dir="$root/dotnet"
target=both native=0 run_tests=0 run=0
started=$(date +%s)

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 not found. $2"; }
# Run a command in a folder, echoing it first.
run_in() { local dir=$1; shift; printf '\033[90m   %s\033[0m\n' "$*"; (cd "$dir" && "$@") || fail "$* failed"; }

for arg in "$@"; do
  case "$arg" in
    both|dotnet|web) target=$arg ;;
    --native) native=1 ;;
    --test) run_tests=1 ;;
    --run) run=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown argument: $arg" ;;
  esac
done
do_web=0; do_dotnet=0
[ "$target" != dotnet ] && do_web=1
[ "$target" != web ] && do_dotnet=1

# ── prerequisites ────────────────────────────────────────────────────────────
if [ $do_web = 1 ]; then
  need node 'Install Node.js 22 or later: https://nodejs.org'
  need npm 'npm comes with Node.js.'
  node_major=$(node --version | sed 's/^v//; s/\..*//')
  [ "$node_major" -ge 22 ] || fail "Node.js 22 or later is needed (found $(node --version))."
fi
if [ $do_dotnet = 1 ]; then
  need dotnet 'Install the .NET 10 SDK (10.0.403 or later): https://dotnet.microsoft.com/download/dotnet/10.0'
  # global.json in dotnet/ makes this fail with a clear message when the SDK is too old.
  sdk=$(cd "$dotnet_dir" && dotnet --version 2>&1) || fail ".NET SDK 10.0.403 or later is needed (dotnet/global.json). $sdk"
fi

# ── TypeScript edition ───────────────────────────────────────────────────────
if [ $do_web = 1 ]; then
  step 'TypeScript edition'
  if [ ! -d "$web/node_modules" ] || [ "$web/package-lock.json" -nt "$web/node_modules" ]; then
    run_in "$web" npm ci --no-audit --no-fund
  fi
  run_in "$web" npm run build
  if [ $do_dotnet = 1 ]; then
    step 'Page for gridanon ui (web -> dotnet/src/GridAnonymizer.Cli/wwwroot)'
    run_in "$web" npm run build:dotnet-ui
  fi
fi

# ── .NET edition ─────────────────────────────────────────────────────────────
exe="$dotnet_dir/out/gridanon"
if [ $do_dotnet = 1 ]; then
  publish=(publish src/GridAnonymizer.Cli -c Release -o out --nologo)
  if [ $native = 1 ]; then
    case "$(uname -s)" in Darwin) os=osx ;; Linux) os=linux ;; *) fail "unsupported OS $(uname -s); use build.ps1 on Windows" ;; esac
    case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) fail "unsupported CPU $(uname -m)" ;; esac
    publish+=(-r "$os-$arch")
    step ".NET edition (native executable, $os-$arch)"
  else
    step '.NET edition (portable)'
  fi
  run_in "$dotnet_dir" dotnet "${publish[@]}"
fi

# ── tests ────────────────────────────────────────────────────────────────────
if [ $run_tests = 1 ]; then
  if [ $do_dotnet = 1 ]; then
    step '.NET tests'
    run_in "$dotnet_dir" dotnet test --nologo
  fi
  if [ $do_web = 1 ]; then
    step 'TypeScript tests'
    run_in "$web" npm run typecheck
    # With a fresh .NET binary, the cross-edition parity tests run too (otherwise they are skipped).
    if [ $do_dotnet = 1 ] && [ -x "$exe" ]; then
      run_in "$web" env GRIDANON_DOTNET="$exe" npm test
    else
      run_in "$web" npm test
    fi
  fi
fi

# ── summary ──────────────────────────────────────────────────────────────────
step "Done in $(( $(date +%s) - started )) s"
if [ $do_web = 1 ]; then
  echo "   Offline page   $web/dist/gridanon-web.html"
  echo "   Node CLI       $web/dist-cli/gridanon.mjs"
fi
if [ $do_dotnet = 1 ]; then
  echo "   .NET CLI / UI  $exe"
  [ $native = 1 ] || printf '\033[90m                  (portable: needs the .NET 10 runtime; add --native for a standalone executable)\033[0m\n'
fi

if [ $run = 1 ]; then
  if [ $do_dotnet = 1 ]; then
    step 'Starting gridanon ui (Ctrl+C to stop)'
    exec "$exe" ui
  else
    step 'Starting the page on http://localhost:8080 (Ctrl+C to stop)'
    cd "$web" && exec npm start
  fi
fi
