#!/bin/sh
# Installs the ceangal CLI into ~/.ceangal/bin (macOS, Linux).
#   curl -fsSL https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.sh | sh
# CEANGAL_VERSION=0.2.0 picks a release (default: the latest);
# CEANGAL_HOME moves the install (default ~/.ceangal).
set -eu

repo="almide-graphics/ceangal2"
home="${CEANGAL_HOME:-$HOME/.ceangal}"
case "$(uname -s)-$(uname -m)" in
  Darwin-*) asset=ceangal-macos-universal.tar.gz ;;
  Linux-x86_64|Linux-amd64) asset=ceangal-linux-x86_64.tar.gz ;;
  Linux-aarch64|Linux-arm64) asset=ceangal-linux-aarch64.tar.gz ;;
  *) echo "ceangal: no build for $(uname -s) $(uname -m); on Windows use install.ps1" >&2; exit 1 ;;
esac
if [ -n "${CEANGAL_VERSION:-}" ]; then url="https://github.com/$repo/releases/download/v${CEANGAL_VERSION#v}/$asset"
else url="https://github.com/$repo/releases/latest/download/$asset"; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $url"
curl -fSL --progress-bar "$url" -o "$tmp/$asset"
# the release's SHA256SUMS: the download is the file that was built
if curl -fsSL "${url%/*}/SHA256SUMS" -o "$tmp/SHA256SUMS" 2>/dev/null; then
  want="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  got="$( (command -v sha256sum >/dev/null && sha256sum "$tmp/$asset" || shasum -a 256 "$tmp/$asset") | cut -d' ' -f1)"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "ceangal: the download does not match the release's checksum ($asset)" >&2
    exit 1
  fi
  echo "Checksum verified"
else
  echo "(this release has no SHA256SUMS: not verified)"
fi
tar xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$home/bin"
mv "$tmp/ceangal" "$home/bin/ceangal"
chmod +x "$home/bin/ceangal"
echo "Installed $("$home/bin/ceangal" --version) in $home/bin"

case ":$PATH:" in
  *":$home/bin:"*) ;;
  *)
    case "${SHELL:-}" in
      */zsh) rc="~/.zshrc" ;;
      */bash) rc="~/.bashrc" ;;
      */fish) rc="~/.config/fish/config.fish" ;;
      *) rc="your shell's startup file" ;;
    esac
    echo
    echo "Add it to your PATH (in $rc):"
    echo "  export PATH=\"$home/bin:\$PATH\""
    ;;
esac
echo
echo "Then:  ceangal new my-app && cd my-app && ceangal dev"
echo "       ceangal doctor    # what each platform needs on this machine"
