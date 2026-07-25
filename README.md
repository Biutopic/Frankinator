# Frankinator

> **Tes sous-titres passent à la moulinette de Frank.**

Frankinator importe des fichiers de sous-titres SRT, corrige les erreurs de transcription (via l'API Claude d'Anthropic), organise les blocs de sous-titres pour les vidéos réseaux sociaux (Reels, TikTok, Shorts…), prévisualise le résultat et exporte un SRT propre, compatible **Adobe Premiere Pro**.

L'application fonctionne avec **n'importe quelle vidéo francophone** : aucune règle, aucun vocabulaire, aucun nom lié à une vidéo particulière n'est codé en dur.

Deux opérations restent strictement séparées :

1. **Correction linguistique** — corrige le texte sans jamais toucher au timing ni à la structure des cues.
2. **Formatage visuel** — calcule les retours à la ligne et les découpages selon un profil (police, taille, largeur…), sans toucher au texte.

---

## Sommaire

- [Installation](#installation)
- [Développement](#développement)
- [Build de production](#build-de-production)
- [Déploiement en ligne (GitHub Pages)](#déploiement-en-ligne-github-pages)
- [Le workflow en 5 étapes](#le-workflow-en-5-étapes)
- [Structure du projet](#structure-du-projet)
- [Où se passe quoi ?](#où-se-passe-quoi-)
- [Créer et calibrer un profil Premiere personnalisé](#créer-et-calibrer-un-profil-premiere-personnalisé)
- [Confidentialité](#confidentialité)
- [Tests](#tests)

---

## Installation

Prérequis : **Node.js 20+** (recommandé : 22) et npm.

```bash
git clone https://github.com/Biutopic/frankinator.git
cd frankinator
npm install
```

Configurez ensuite la clé API pour la correction IA (facultatif — le formatage fonctionne sans IA) :

```bash
cp .env.example .env.local
# puis renseignez ANTHROPIC_API_KEY=sk-ant-…
```

La clé s'obtient sur <https://console.anthropic.com/>. Elle reste **côté serveur** et n'est jamais exposée au navigateur.

## Développement

```bash
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

## Build de production

```bash
npm run lint    # vérification ESLint
npm test        # tests automatisés (Vitest)
npm run build   # build de production Next.js
npm start       # serveur de production
```

## Déploiement en ligne (GitHub Pages)

Le dépôt contient un workflow GitHub Actions ([.github/workflows/pages.yml](.github/workflows/pages.yml)) qui publie automatiquement une **version statique** de Frankinator sur GitHub Pages à chaque push sur `main` — comme pour Trashure Island.

Particularité du mode statique : GitHub Pages ne peut pas héberger la route serveur `/api/correct`. Dans cette version :

- l'import, le formatage, l'aperçu et les exports fonctionnent **intégralement** (tout est local) ;
- pour la correction IA, l'utilisateur saisit **sa propre clé API Anthropic**, stockée uniquement dans le `localStorage` de **son** navigateur et envoyée directement à l'API Anthropic (jamais à un serveur tiers, jamais dans le code).

Mise en ligne :

1. Créez un dépôt `frankinator` sur GitHub (ex. dans l'organisation Biutopic).
2. `git remote add origin https://github.com/Biutopic/frankinator.git && git push -u origin main`
3. Dans les réglages du dépôt : **Settings → Pages → Source : GitHub Actions**.
4. L'app sera servie sur `https://biutopic.github.io/frankinator/`.

Pour une version en ligne **avec** la route serveur sécurisée (clé cachée côté serveur), déployez plutôt sur Vercel ou Cloudflare (build `npm run build` standard) avec la variable d'environnement `ANTHROPIC_API_KEY`.

## Le workflow en 5 étapes

1. **Importer** — glisser-déposer, sélection de fichier ou texte SRT collé. Validation complète (structure, numérotation, timecodes, doublons, chevauchements, encodage, blocs corrompus). Aucun sous-titre n'est écarté silencieusement. Contexte vidéo, glossaire, transcript de référence et profils de correction réutilisables.
2. **Corriger** — correction conservatrice via Claude (orthographe, ponctuation, typographie française, erreurs de transcription…). Chaque proposition est affichée avec ses différences surlignées, un indicateur de confiance, et des boutons Accepter / Rejeter / Modifier / Verrouiller / Restaurer. Recherche-remplacement, filtres, annuler/rétablir, raccourcis clavier. **L'utilisateur garde le contrôle de chaque changement.**
3. **Formater** — profils réutilisables (Reel Instagram — Premiere, TikTok, Shorts, 16:9, personnalisé), mesure **pixel réelle** du texte via l'API Canvas, découpe en 2 lignes max avec score linguistique (mots faibles, expressions protégées, équilibre visuel), découpage des cues trop longs avec redistribution du temps, suggestions de fusion (jamais automatiques), vitesse de lecture.
4. **Vérifier** — aperçu 1080×1920 (ou autre format) fidèle au moteur de mesure, lecture selon les timecodes, image/vidéo de fond locale, position du texte glissable, zones de sécurité et guides, timeline éditable (timing, scission, fusion, déplacement de mots, verrouillage, restauration).
5. **Exporter** — validation finale (checklist Premiere Pro) et fichiers :
   - `nom_FRANKINATED_CLEAN.srt` — SRT corrigé, structure d'origine
   - `nom_FRANKINATED_FORMATTED.srt` — SRT corrigé **et** formaté
   - `nom_FRANKINATED.txt` — transcript texte
   - `nom_FRANKINATED_REPORT.json` — rapport de correction
   - `profil_FRANKINATOR_PROFILE.json` — profil de formatage exportable

La session est sauvegardée automatiquement en local (récupération après rafraîchissement ou fermeture).

## Structure du projet

```
frankinator/
├── src/
│   ├── app/
│   │   ├── api/correct/route.ts   # route serveur Claude (clé côté serveur)
│   │   ├── layout.tsx             # layout + police Anybody
│   │   └── page.tsx               # point d'entrée (rendu client)
│   ├── components/
│   │   ├── App.tsx                # coquille + navigation des 5 étapes
│   │   ├── DiffText.tsx           # surlignage des différences
│   │   ├── useMeasurer.ts         # hook : mesureur Canvas + police
│   │   └── steps/                 # ImportStep, CorrectStep, FormatStep,
│   │                              # VerifyStep, ExportStep
│   └── lib/
│       ├── types.ts               # types partagés + profils par défaut
│       ├── store.ts               # état global (zustand + persistance locale)
│       ├── export.ts              # exports + checklist de validation
│       ├── srt/                   # timecode.ts, parse.ts, serialize.ts
│       ├── text/                  # tokenize.ts, protected.ts, weakWords.ts,
│       │                          # typography.ts, diff.ts
│       ├── format/                # measure.ts, linebreak.ts, split.ts,
│       │                          # merge.ts, readingSpeed.ts, formatter.ts
│       └── correction/            # schema.ts (Zod), prompt.ts, client.ts
├── tests/                         # tests Vitest + fixtures SRT génériques
├── .github/workflows/pages.yml    # déploiement GitHub Pages
└── .env.example
```

## Où se passe quoi ?

| Sujet | Fichier(s) |
|---|---|
| **Corrections linguistiques** | [src/lib/correction/prompt.ts](src/lib/correction/prompt.ts) (règles conservatrices envoyées à Claude), [src/lib/correction/schema.ts](src/lib/correction/schema.ts) (validation Zod des réponses, récupération des réponses partielles), [src/app/api/correct/route.ts](src/app/api/correct/route.ts) (route serveur), [src/lib/correction/client.ts](src/lib/correction/client.ts) (transports serveur/navigateur). La typographie française déterministe est dans [src/lib/text/typography.ts](src/lib/text/typography.ts). |
| **Mesure du texte** | [src/lib/format/measure.ts](src/lib/format/measure.ts) — interface `TextMeasurer` unique (Canvas en production, mesureur déterministe en test). Le **même** mesureur sert à la découpe, l'aperçu, la détection de dépassement et la validation d'export. Chargement de police + repli explicite dans [src/components/useMeasurer.ts](src/components/useMeasurer.ts). |
| **Score des retours à la ligne** | [src/lib/format/linebreak.ts](src/lib/format/linebreak.ts) — `scoreBreak()` évalue chaque frontière de mot (largeur, ponctuation, mots faibles, équilibre, expressions protégées) ; `breakIntoLines()` choisit la meilleure coupe. Mots faibles : [src/lib/text/weakWords.ts](src/lib/text/weakWords.ts). Expressions protégées : [src/lib/text/protected.ts](src/lib/text/protected.ts). |
| **Redistribution du timing** | [src/lib/format/split.ts](src/lib/format/split.ts) — `splitLongCue()` découpe un cue trop long en cues consécutifs : partition sémantique, poids caractères + ponctuation, plancher de durée configurable (600 ms par défaut), intervalle global préservé, ni trous ni chevauchements. Orchestration : [src/lib/format/formatter.ts](src/lib/format/formatter.ts). |

## Créer et calibrer un profil Premiere personnalisé

1. Étape **Formater** → sélectionnez « Reel Instagram — Premiere » → **Dupliquer**.
2. Dans votre projet Premiere, notez les réglages de votre calque de texte : police, graisse, corps (px), interlettrage (tracking), interligne, et la largeur utile de votre zone de texte (largeur séquence − marges).
3. Reportez ces valeurs dans le profil : *Police*, *Graisse*, *Taille de police*, *Tracking (em)* (Premiere exprime le tracking en millièmes d'em : `-40` → `-0.04`), *Largeur max du texte (px)*, *Marges de sécurité*.
4. Vérifiez la calibration : formatez quelques sous-titres, importez le SRT dans Premiere et comparez. Si Premiere coupe plus tôt que Frankinator, réduisez « Largeur max du texte » ; s'il reste trop de marge, augmentez-la.
5. **Exporter** le profil (`…_FRANKINATOR_PROFILE.json`) pour le partager ou le réimporter.

Préréglage initial fourni : police **Anybody ExtraBold**, 65 px, tracking ≈ −0,04 em, canvas 1080×1920, 2 lignes max.

## Confidentialité

- L'analyse SRT se fait **localement**, dans votre navigateur.
- Le formatage se fait **localement**.
- Les médias d'aperçu (image/vidéo) restent **locaux** et ne sont jamais envoyés à Claude.
- Seul le **texte des sous-titres à corriger** (plus glossaire/contexte fournis) est envoyé à Claude — jamais les timecodes.
- Aucun fichier n'est stocké de façon permanente ; la session vit dans le `localStorage` de votre navigateur.
- La clé API est conservée **côté serveur** (`.env.local`). En version statique, la clé saisie par l'utilisateur reste dans **son** navigateur.
- Le formatage est utilisable **sans** correction IA.

## Tests

```bash
npm test
```

115 tests couvrent : parsing/sérialisation SRT, conversion de timecodes, numérotation, chevauchements, tokenisation des apostrophes françaises, expressions protégées (noms propres, nombres + unités, heures…), mesure en pixels, repli de police, règle des deux lignes, score des coupes, pénalité des mots faibles, découpage des cues longs, distribution des durées, durée minimale, fusion optionnelle, vitesse de lecture, validation Zod des réponses Claude (dont réponses partielles et immutabilité des timecodes), restauration des originaux, invariance des cues verrouillés, export UTF-8.

---

*Frankinator est un outil BIUTOPIC. Fait avec 🧪 et beaucoup de sous-titres mal transcrits.*
