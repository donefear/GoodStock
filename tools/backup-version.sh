#!/usr/bin/env bash
# Backs up a Goodstock X.Y.0 version in three ways:
#   1. a git tag vX.Y.0 (an annotated tag on the commit that carries that version label),
#   2. pushing the tag, which makes GitHub build the APK, desktop apps and iOS .ipa and attach them to a release,
#   3. a local copy in backups/vX.Y.0/: the source as a zip (git archive of the tag) plus any builds in dist/ for
#      that version. backups/ is not committed.
#
# Usage (Git Bash or WSL, from anywhere in the repository):
#   bash tools/backup-version.sh            # the version in index.html; it must end in .0
#   bash tools/backup-version.sh 3.0.0      # a given version; an existing tag is reused
#   bash tools/backup-version.sh --no-push  # tag and zip only
#   bash tools/backup-version.sh --any      # also allow versions that don't end in .0
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

push=1 any=0 version=''
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    --any) any=1 ;;
    v[0-9]*|[0-9]*) version="${arg#v}" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

label_version() { # the "Goodstock vX.Y.Z" label in index.html at a commit
  git show "$1:index.html" 2>/dev/null | grep -oE 'Goodstock v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -d v -f 2
}

[ -n "$version" ] || version=$(label_version HEAD)
[ -n "$version" ] || { echo "No 'Goodstock vX.Y.Z' label found in index.html." >&2; exit 1; }
if [ "$any" = 0 ] && [ "${version##*.}" != 0 ]; then
  echo "v$version is not an X.Y.0 version; pass --any to back it up anyway." >&2; exit 1
fi
tag="v$version"

# 1. The tag. A new one goes on HEAD, which must carry that version label; otherwise find the commit that set it.
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists ($(git rev-parse --short "$tag^{commit}"))."
else
  commit=HEAD
  if [ "$(label_version HEAD)" != "$version" ]; then
    commit=$(git log --format=%H -G"Goodstock v${version//./\\.}([^0-9]|$)" -- index.html | tail -1)
    [ -n "$commit" ] || { echo "No commit has the label Goodstock v$version." >&2; exit 1; }
  fi
  git tag -a "$tag" -m "Goodstock $tag" "$commit"
  echo "Tagged $tag on $(git rev-parse --short "$commit") $(git log -1 --format=%s "$commit")"
fi

# 2. Push the tag; GitHub Actions build the apps and attach them to the release.
if [ "$push" = 1 ]; then
  git push origin "refs/tags/$tag"
  echo "Pushed $tag. The release appears at https://github.com/donefear/GoodStock/releases/tag/$tag once the builds finish."
fi

# 3. Local copy.
out="backups/$tag"
mkdir -p "$out"
git archive --format=zip --prefix="Goodstock-$tag/" -o "$out/Goodstock-$tag-source.zip" "$tag"
shopt -s nullglob
builds=(dist/*"-$tag"[.-]* dist/desktop/*"-$tag-"*)
for file in "${builds[@]}"; do cp "$file" "$out/"; done
echo "Saved $out/ (source zip and ${#builds[@]} build file(s) from dist/)."
