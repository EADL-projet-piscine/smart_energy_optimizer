#!/bin/sh
# Contrôles bloquants partagés par les hooks Git et la CI (job lint) : ce qui passe en
# local passe sur la pull request. Aucun Python requis sur le poste : ruff est un binaire
# autonome, téléchargé à la version épinglée dans pyproject.toml, empreinte vérifiée.
#
#   sh scripts/check.sh            contrôle le commit courant (HEAD), comme la CI
#   sh scripts/check.sh <commit>   contrôle un commit donné (hook pre-push)
#   sh scripts/check.sh --staged   contrôle les fichiers indexés (hook pre-commit)
#
# Contrôles : ruff check, ruff format, espaces en fin de ligne, lignes vides en fin de
# fichier, marqueurs de conflit, saut de ligne final manquant, fichiers de plus de 1 Mo.
set -eu

cd "$(git rev-parse --show-toplevel)"

TAILLE_MAX=1048576
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- ruff autonome -------------------------------------------------------------------

RUFF_VERSION=$(sed -n 's/.*"ruff==\([0-9][0-9.]*\)".*/\1/p' pyproject.toml | head -n 1)
if [ -z "$RUFF_VERSION" ]; then
    echo "Version de ruff introuvable dans pyproject.toml (attendu : \"ruff==X.Y.Z\")." >&2
    exit 1
fi

case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) cible=pc-windows-msvc archive=zip exe=ruff.exe ;;
    Linux) cible=unknown-linux-gnu archive=tar.gz exe=ruff ;;
    Darwin) cible=apple-darwin archive=tar.gz exe=ruff ;;
    *) echo "Système non pris en charge : $(uname -s)" >&2 && exit 1 ;;
esac
case "$(uname -m)" in
    x86_64 | amd64) arch=x86_64 ;;
    aarch64 | arm64) arch=aarch64 ;;
    *) echo "Architecture non prise en charge : $(uname -m)" >&2 && exit 1 ;;
esac

RUFF="$PWD/.tools/ruff/$exe"
if [ ! -x "$RUFF" ] || [ "$(cat .tools/ruff/VERSION 2>/dev/null)" != "$RUFF_VERSION" ]; then
    paquet="ruff-$arch-$cible.$archive"
    url="https://github.com/astral-sh/ruff/releases/download/$RUFF_VERSION/$paquet"
    echo "Téléchargement de ruff $RUFF_VERSION ($paquet)"
    curl -fsSL -o "$tmp/$paquet" "$url"
    curl -fsSL -o "$tmp/$paquet.sha256" "$url.sha256"
    attendu=$(cut -d ' ' -f 1 <"$tmp/$paquet.sha256")
    if command -v sha256sum >/dev/null 2>&1; then
        calcule=$(sha256sum "$tmp/$paquet" | cut -d ' ' -f 1)
    else
        calcule=$(shasum -a 256 "$tmp/$paquet" | cut -d ' ' -f 1)
    fi
    if [ "$attendu" != "$calcule" ]; then
        echo "Empreinte SHA-256 invalide pour $paquet : binaire refusé." >&2
        exit 1
    fi
    mkdir "$tmp/paquet"
    if [ "$archive" = zip ]; then
        unzip -q "$tmp/$paquet" -d "$tmp/paquet"
    else
        tar -xzf "$tmp/$paquet" -C "$tmp/paquet"
    fi
    rm -rf .tools/ruff
    mkdir -p .tools/ruff
    find "$tmp/paquet" -name "$exe" -type f -exec mv {} "$RUFF" \;
    chmod +x "$RUFF"
    echo "$RUFF_VERSION" >.tools/ruff/VERSION
fi

# --- Arbre contrôlé : l'index (commit en préparation) ou un commit existant ------------

vide=$(git hash-object -t tree /dev/null)
if [ "${1:-}" = "--staged" ]; then
    mode=index
    arbre=$(git write-tree)
    base=$(git rev-parse -q --verify "HEAD^{tree}" || echo "$vide")
else
    commit=$(git rev-parse --verify "${1:-HEAD}^{commit}")
    mode="commit $(git rev-parse --short "$commit")"
    arbre=$commit
    base=$vide
fi

# Différences entre base et arbre : les fichiers modifiés pour l'index, tout pour un commit.
diff_git() {
    git -c core.quotePath=false -c core.whitespace=trailing-space,-space-before-tab \
        diff --no-color --no-ext-diff --no-textconv --no-renames \
        --src-prefix=a/ --dst-prefix=b/ "$@" "$base" "$arbre"
}

# Fichiers ordinaires ajoutés ou modifiés (ni liens symboliques, ni sous-modules).
diff_git --raw --diff-filter=ACM |
    awk -F '\t' '{ split($1, m, " "); if (m[2] ~ /^100(644|755)$/) print $2 }' >"$tmp/fichiers"
grep -E '\.pyi?$' "$tmp/fichiers" >"$tmp/python" || true

erreurs=0
corriges=""

# --- Espaces en fin de ligne, lignes vides en fin de fichier, marqueurs de conflit ----

if ! diff_git --check >"$tmp/espaces" 2>&1; then
    echo "Espaces en fin de ligne, lignes vides en fin de fichier ou marqueurs de conflit :"
    sed 's/^/  /' "$tmp/espaces"
    erreurs=1
fi

# --- Saut de ligne final : git signale « \ No newline at end of file » ----------------

diff_git --diff-filter=ACM | awk '
    /^diff --git / { lien = 0; next }
    /^(new file mode|new mode) 120000/ { lien = 1; next }
    /^\+\+\+ b\// { fichier = substr($0, 7); next }
    /^\\ / { if (!lien && precedente !~ /^-/) print "Saut de ligne manquant en fin de fichier : " fichier; next }
    { precedente = $0 }
' >"$tmp/fins"
if [ -s "$tmp/fins" ]; then
    cat "$tmp/fins"
    erreurs=1
fi

# --- Taille des fichiers ---------------------------------------------------------------

git -c core.quotePath=false ls-tree -r -l "$arbre" | awk -F '\t' -v max="$TAILLE_MAX" '
    NR == FNR { controle[$0] = 1; next }
    ($2 in controle) { split($1, m, " "); if (m[4] > max) print "Fichier de plus de 1 Mo : " $2 }
' "$tmp/fichiers" - >"$tmp/gros"
if [ -s "$tmp/gros" ]; then
    cat "$tmp/gros"
    erreurs=1
fi

# --- ruff check et ruff format, sur une copie exacte de l'arbre contrôlé ---------------

if [ -s "$tmp/python" ]; then
    mkdir "$tmp/arbre"
    git archive "$arbre" | tar -x -C "$tmp/arbre"
    set -f
    IFS='
'
    python=$(cat "$tmp/python")
    ruff_ko=0
    if ! (cd "$tmp/arbre" && "$RUFF" check --force-exclude --quiet --output-format concise $python); then
        ruff_ko=1
    fi
    if ! (cd "$tmp/arbre" && "$RUFF" format --check --force-exclude --quiet --output-format concise $python); then
        ruff_ko=1
    fi
    if [ "$ruff_ko" -eq 1 ]; then
        erreurs=1
        # Au commit : corrige la copie de travail des fichiers sans modifications non indexées.
        if [ "$mode" = index ]; then
            propres=""
            for f in $python; do
                if git -c core.safecrlf=false diff --quiet -- "$f"; then
                    propres="$propres
$f"
                fi
            done
            if [ -n "$propres" ]; then
                "$RUFF" check --fix --force-exclude --quiet $propres >/dev/null 2>&1 || true
                "$RUFF" format --force-exclude --quiet $propres >/dev/null 2>&1 || true
                corriges=$(git -c core.quotePath=false -c core.safecrlf=false diff --name-only -- $propres)
            fi
        fi
    fi
    unset IFS
    set +f
fi

if [ "$erreurs" -ne 0 ]; then
    if [ -n "$corriges" ]; then
        echo
        echo "Corrigé automatiquement par ruff ; relisez, puis git add et relancez le commit :"
        echo "$corriges" | sed 's/^/  /'
    fi
    echo
    echo "Échec ($mode) : ces contrôles feraient échouer la CI de la pull request." >&2
    exit 1
fi
echo "Contrôles OK ($mode) : ruff $RUFF_VERSION, formatage, fichiers."
