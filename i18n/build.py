#!/usr/bin/env python3
"""Vérifie les traductions puis génère i18n/<lang>.js.

  python3 i18n/build.py          # vérifie en + zh et génère les .js
  python3 i18n/build.py --check  # vérifie seulement

Sources :
  i18n/fr-source.json  liste des textes français (clé) + où ils apparaissent
  i18n/<lang>.json     { "texte français": "traduction", ... }

Règles vérifiées :
  - chaque texte français a une traduction non vide ;
  - mêmes variables {x} ;
  - toute balise AVEC attributs (class, id, aria-hidden…) est conservée à l'identique,
    car le JS et le CSS s'appuient dessus ; les balises de mise en forme sans attribut
    (<b>, <em>, <sup>, <small>, <br>…) peuvent bouger ou disparaître ;
  - balises ouvrantes / fermantes équilibrées.
"""
import json, re, sys, pathlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent
LANGS = ["en", "zh"]
VOID = {"br", "wbr", "img", "hr", "input"}
OPEN = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*?)?\s*/?>")
CLOSE = re.compile(r"</([a-zA-Z][a-zA-Z0-9]*)\s*>")
VAR = re.compile(r"\{(\w+)\}")


def tags_with_attrs(s):
    return Counter(m.group(0) for m in OPEN.finditer(s) if m.group(2) and m.group(2).strip())


def balanced(s):
    o = Counter(m.group(1).lower() for m in OPEN.finditer(s) if m.group(1).lower() not in VOID)
    c = Counter(m.group(1).lower() for m in CLOSE.finditer(s))
    return o == c


def check(lang, src):
    p = ROOT / f"{lang}.json"
    if not p.exists():
        return [f"{p.name} absent"], {}
    tr = json.loads(p.read_text())
    errs = []
    for item in src:
        fr = item["fr"]
        t = tr.get(fr)
        if not isinstance(t, str) or not t.strip():
            errs.append(f"MANQUANT  {fr[:80]!r}")
            continue
        if set(VAR.findall(fr)) != set(VAR.findall(t)):
            errs.append(f"VARIABLES {fr[:60]!r} -> {t[:60]!r}")
        if tags_with_attrs(fr) != tags_with_attrs(t):
            errs.append(f"BALISES   {fr[:60]!r}\n          attendu {sorted(tags_with_attrs(fr))}\n          trouvé  {sorted(tags_with_attrs(t))}")
        if not balanced(t):
            errs.append(f"DÉSÉQUILIBRE {t[:80]!r}")
    extra = set(tr) - {i["fr"] for i in src}
    for k in sorted(extra):
        errs.append(f"EN TROP   {k[:80]!r} (clé absente de fr-source.json)")
    return errs, tr


def main():
    src = json.loads((ROOT / "fr-source.json").read_text())
    ok = True
    for lang in LANGS:
        errs, tr = check(lang, src)
        print(f"[{lang}] {len(src) - sum(e.startswith('MANQUANT') for e in errs)}/{len(src)} traduits, {len(errs)} problème(s)")
        for e in errs[:60]:
            print("   ", e)
        if errs:
            ok = False
            continue
        if "--check" not in sys.argv:
            body = json.dumps({i["fr"]: tr[i["fr"]] for i in src}, ensure_ascii=False, indent=0)
            (ROOT / f"{lang}.js").write_text(
                "/* Généré par i18n/build.py depuis i18n/%s.json : ne pas modifier à la main. */\n"
                "(window.BM_I18N = window.BM_I18N || { dicts: {} }).dicts.%s = %s;\n" % (lang, lang, body))
            print(f"    -> i18n/{lang}.js écrit")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
