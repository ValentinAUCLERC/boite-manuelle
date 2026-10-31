# La boîte manuelle, sans stress

Petit site mobile-first pour passer d'une boîte automatique à une boîte manuelle (Opel Agila 5 vitesses) :
embrayage animé, grille des vitesses, simulateur anti-calage tactile, gestes pas à pas, quiz.

HTML/CSS/JS statique, sans dépendance ni build. Polices Bricolage Grotesque et Inter Tight (SIL OFL, voir `fonts/`).

```bash
python3 -m http.server 8000
```

## Langues (FR / EN / 中文)

Le français est la source. `i18n.js` traduit la page au chargement à partir des dictionnaires
`i18n/en.js` et `i18n/zh.js` (choix : `?lang=en`, bouton FR/EN/中文, sinon langue du téléphone).

Après une modification de texte :

1. extraire les textes français vers `i18n/fr-source.json` (textes de la page + appels `T("…")` / `tr("…")` dans les scripts) ;
2. compléter `i18n/en.json` et `i18n/zh.json` (clé = texte français exact) ;
3. `python3 i18n/build.py` : vérifie (traductions manquantes, variables `{x}`, balises) et régénère les `.js` ;
4. incrémenter `?v=N` dans `index.html`.

Un texte sans traduction reste en français et apparaît dans la console (`[i18n] … textes sans traduction`).
