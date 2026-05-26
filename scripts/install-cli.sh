#!/bin/sh
set -eu

repo="${VISTA_REPO:-ejohane/vista}"
install_dir="${VISTA_INSTALL_DIR:-$HOME/.local/bin}"
requested_version="${VISTA_VERSION:-latest}"
binary_name="${VISTA_BINARY_NAME:-vista}"

case "$(uname -s)" in
  Darwin)
    os="darwin"
    ;;
  Linux)
    os="linux"
    ;;
  *)
    echo "Vista CLI is not available for $(uname -s)." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64)
    arch="arm64"
    ;;
  x86_64 | amd64)
    arch="x64"
    ;;
  *)
    echo "Vista CLI is not available for $(uname -m)." >&2
    exit 1
    ;;
esac

if [ "$os" = "linux" ] && [ "$arch" = "x64" ]; then
  asset="vista-bun-linux-x64-baseline.tar.gz"
else
  asset="vista-bun-${os}-${arch}.tar.gz"
fi

if [ "$requested_version" = "latest" ] || [ -z "$requested_version" ]; then
  tag=""
  download_base="https://github.com/${repo}/releases/latest/download"
else
  case "$requested_version" in
    v*)
      tag="$requested_version"
      ;;
    *)
      tag="v${requested_version}"
      ;;
  esac
  download_base="https://github.com/${repo}/releases/download/${tag}"
fi

tmp_dir="$(mktemp -d)"
archive_path="${tmp_dir}/${asset}"
checksum_path="${archive_path}.sha256"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

download_with_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    return 1
  fi

  if [ -n "$tag" ]; then
    gh release download "$tag" \
      --repo "$repo" \
      --pattern "$asset" \
      --pattern "${asset}.sha256" \
      --dir "$tmp_dir" \
      --clobber
  else
    gh release download \
      --repo "$repo" \
      --pattern "$asset" \
      --pattern "${asset}.sha256" \
      --dir "$tmp_dir" \
      --clobber
  fi
}

curl_download() {
  url="$1"
  out="$2"
  token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

  if [ -n "$token" ]; then
    curl -fsSL \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/octet-stream" \
      "$url" \
      -o "$out"
  else
    curl -fsSL "$url" -o "$out"
  fi
}

download_with_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "Install requires curl or gh." >&2
    exit 1
  fi

  curl_download "${download_base}/${asset}" "$archive_path"
  curl_download "${download_base}/${asset}.sha256" "$checksum_path"
}

verify_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$tmp_dir" && sha256sum -c "${asset}.sha256")
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    (cd "$tmp_dir" && shasum -a 256 -c "${asset}.sha256")
    return
  fi

  echo "Install requires sha256sum or shasum to verify downloads." >&2
  exit 1
}

if ! download_with_gh; then
  download_with_curl
fi

verify_checksum
tar -xzf "$archive_path" -C "$tmp_dir"

if [ ! -f "${tmp_dir}/vista" ]; then
  echo "${asset} did not contain a vista binary." >&2
  exit 1
fi

mkdir -p "$install_dir"
target_path="${install_dir}/${binary_name}"

if [ ! -w "$install_dir" ]; then
  echo "${install_dir} is not writable. Set VISTA_INSTALL_DIR to a writable directory." >&2
  exit 1
fi

if command -v install >/dev/null 2>&1; then
  install -m 0755 "${tmp_dir}/vista" "$target_path"
else
  cp "${tmp_dir}/vista" "$target_path"
  chmod 0755 "$target_path"
fi

echo "Installed vista to ${target_path}."
"$target_path" version

case ":$PATH:" in
  *":$install_dir:"*)
    ;;
  *)
    echo "${install_dir} is not on PATH. Add it before running vista from any directory." >&2
    ;;
esac
