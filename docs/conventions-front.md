# Conventions du front-end

Ce document décrit comment est organisé `app/front`. Il est à lire avant
d'écrire du code dans ce dossier.

## Principe

Le front est un dashboard React servi par Vite. Il ne contient **aucune
règle métier de calcul** : il affiche ce que l'API métier lui donne, et
s'arrête quand elle ne répond plus.

Trois couches, du plus bas au plus haut :

| Couche | Dossier | Rôle |
|---|---|---|
| Accès réseau | `src/api/` | Un seul point de sortie HTTP, avec délai d'expiration |
| Services | `src/services/` | Normalisation, agrégation, formatage. Pas de JSX. |
| Affichage | `src/components/`, `src/screens/` | Composants React. Pas d'appel réseau. |

Un composant n'appelle jamais `fetch` directement : il consomme un hook
(`useSummary`, `useHistory`) qui s'en charge. Cela permet de tester toute
la logique de données sans monter de composant.

La frontière entre un service et un hook est celle du **quoi** et du
**quand**. `history.ts` sait aller chercher l'historique et le transformer
en série affichable : il ignore React, prend un signal d'annulation et rend
une promesse. `useHistory.ts` décide du moment : premier appel au montage,
rafraîchissement périodique, annulation au démontage, et exposition de
l'état au composant. Mettre la transformation dans le hook obligerait à
monter un composant pour tester une addition.

## Structure

```
src/
├── api/client.ts          Appel HTTP unique, délai d'expiration, erreurs
├── components/            Composants réutilisables
│   ├── ui/                Briques génériques : Card, Metric, Banner, Badge…
│   ├── Icons.tsx          Icônes SVG
│   └── ConsumptionChart.tsx
├── screens/               Écrans : Dashboard, SiteDetail
├── services/              Modèle, normalisation, formatage, hooks
├── data/                  Jeux de données de démonstration
├── tests/                 Tests, en miroir de l'arborescence ci-dessus
└── styles.css             Thème : variables CSS et classes Tailwind
```

## Nommage

**Les identifiants sont en anglais** : variables, fonctions, props, types,
noms de composants, noms de fichiers. `formatHour`, `ConsumptionChart`,
`seriesBySite`, `BadgeTone`.

**Les tokens CSS restent en français** : `bg-carte`, `text-encre`,
`stroke-mesure`, `border-seuil`. Ils sont définis dans `styles.css` et
appartiennent à la charte graphique, pas au code. Les renommer n'apporterait
rien et casserait le thème.

**Les textes affichés sont en français**, ainsi que les commentaires et les
docstrings.

**Les valeurs de données restent telles que l'API les fournit.** `Severity`
vaut `'critique' | 'moyenne' | 'info'` : ce sont des données, pas des
identifiants. Il en va de même pour `dataQuality`, qui vaut `'good'`,
`'partial'`, `'degraded'` ou `'critical'` : `qualityLabel()` les traduit à
l'affichage, le modèle les garde tels quels.

> Attention aux renommages mécaniques. Un `sed` sur un identifiant traverse
> les chaînes de caractères, et TypeScript ne le voit pas. Un renommage
> massif a déjà produit « % sur une hour », « Une alert a été levée » et,
> plus grave, une URL d'endpoint renommée qui a fait basculer le dashboard
> sur les données de démonstration sans erreur visible. Après tout
> renommage : relire les chaînes, et regarder l'écran.

## Données et erreurs

**Jamais de données inventées.** Si l'API métier ne répond pas, l'écran le
dit. Le dernier résumé réellement reçu peut rester affiché, mais il est
alors signalé par un bandeau et une pastille rouge. Un dashboard qui a l'air
de fonctionner alors que rien ne tourne derrière est pire qu'un dashboard en
erreur.

**Une mesure absente reste `null`.** Jamais zéro : zéro est une mesure,
l'absence de mesure n'en est pas une. Sur un graphique, une valeur manquante
interrompt la courbe au lieu d'être reliée.

**Les horodatages portent leur fuseau.** L'API source date `/stats/summary`
et `/sites/{id}/current` sans fuseau alors qu'il s'agit d'UTC, et
`/readings` avec un `Z`. `toIsoUtc()` normalise les trois. Sans cela,
JavaScript lit un horodatage nu comme de l'heure locale et affiche deux
heures de moins en France, sans erreur.

**Un point de série est daté, pas numéroté.** `SeriesPoint` porte `at`, une
chaîne ISO. Un entier d'heure ne distingue pas 9h hier de 9h aujourd'hui :
sur une fenêtre glissante, trier par heure relie deux points séparés de
vingt-trois heures.

**Un champ affiché a une seule source.** Deux endpoints qui servent la même
donnée, ce sont deux versions de la vérité, et c'est toujours celle qu'on ne
regarde pas qui est la bonne. Voir la section suivante.

## Endpoints consommés

| Service | Endpoint | Ce qu'il apporte |
|---|---|---|
| `summary.ts` | `GET /api/consommations` | le parc : totaux, consommation et capacité de chaque site, alertes |
| `details.ts` | `GET /api/consommations/sites` | par site : qualité de la mesure, causes d'absence, grandeurs électriques |
| `history.ts` | `GET /api/consommations/historique` | les 24 dernières heures, par site et pour le parc |
| `session.ts` | `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout` | la session : faut-il se connecter, qui est connecté, quels sites il voit |

**Session.** `useSession` décide de l'écran : connexion ou dashboard. Le jeton
vit dans un cookie `HttpOnly` que le dashboard ne lit jamais ; `fetchJson`
l'envoie avec chaque appel. Une réponse 401, d'où qu'elle vienne (session
expirée au bout de 15 minutes), émet `UNAUTHORIZED_EVENT` et ramène à l'écran
de connexion. Si l'API est ouverte (`AUTH_ENABLED=false`) ou ne connaît pas
`/api/auth/me`, le dashboard s'affiche comme avant. Le filtrage par site est
fait par l'API : le dashboard affiche ce qu'il reçoit.

**Le résumé dit *combien*, le détail dit *pourquoi*.** Les deux portent
`consumption_kw`, et c'est le seul recouvrement : la consommation affichée à
l'écran vient **toujours du résumé**, parce que le total du parc en est
dérivé et qu'une valeur prise à un autre instant ferait que la somme des
sites ne tombe plus juste. Du détail viennent `dataQuality`, `nullReasons`,
la tension, l'intensité, la température et l'humidité — que le résumé ne
contient pas.

**Le détail n'est pas une autorité sur la fraîcheur du résumé.** Les deux
endpoints sont décorrélés : quand le résumé porte un chiffre, il vient du
cycle courant et il est à jour, même si le détail signale au même moment une
panne du compteur. Avoir conclu l'inverse a produit un écran qui annonçait
« relevé de 14h43 » alors que la collecte datait de 14h43.

### Ce qui voyage dans l'enveloppe

`/api/consommations` renvoie le résumé de la source dans `data`, et à côté
deux champs que l'API métier calcule elle-même :

| Champ | Attaché par | Devient |
|---|---|---|
| `last_readings` | `attachLastReadings` | `site.lastKnownKw`, `site.lastKnownAt` |
| `alertes` | `attachCapacityAlerts` | des entrées de `site.alerts` |

`normalizeSummary` ne voit que `data` : ces deux champs vivent à l'extérieur
et s'attachent donc **après** la normalisation, dans `summary.ts`. C'est
aussi pour cela que `lastKnownKw` et `lastKnownAt` sont **optionnels** dans
`Site`, et non simplement nuls : un back qui ne les fournit pas reste
valide, et l'écran doit fonctionner sans eux.

`attachCapacityAlerts` repasse par `buildSummary` : les compteurs du bandeau
et les badges se déduisent des alertes des sites, qui viennent de changer.
Sans cela, l'écran continuerait d'annoncer zéro alerte.

Le détail est un **complément** : s'il échoue, l'écran perd son bloc
« État de l'installation » et garde tout le reste. C'est pour cela que
`useSummary` les charge avec `Promise.allSettled` et non `Promise.all`.

Les chemins sont écrits dans les services, jamais dans un composant. Ce sont
des **chaînes de caractères** : ni TypeScript ni Biome ne les vérifie, et une
faute de frappe produit un 404 que rien ne signale à la compilation. Après
toute modification d'un chemin, ouvrir `/docs` côté back pour comparer les
URL complètes, puis regarder l'onglet réseau du navigateur.

La convention de nommage des endpoints est décrite dans
`conventions-back.md` : collection au pluriel, vue calculée au singulier.

## Graphiques

Les graphiques utilisent **Recharts**. Les couleurs passent par les
variables CSS du thème (`var(--mesure)`, `var(--ambre)`) pour que le mode
clair et le mode sombre fonctionnent sans JavaScript.

La ligne de repère trace la **capacité du site**, en ambre, la même couleur
que le bandeau d'alerte : les deux désignent la même limite, ils doivent se
répondre à l'œil. Elle n'est pas tracée sur le graphique du parc — la somme
des sept capacités est une limite théorique, jamais atteinte simultanément,
et le total affiché exclut les sites muets : comparer les deux ne compare
rien.

`connectNulls` reste à `false` : une mesure absente doit couper la courbe.

`type="monotone"` sur les courbes : l'interpolation ne dépasse jamais les
points de données. Les autres modes de lissage peuvent faire monter la
courbe au-dessus de la valeur réelle, ce qui n'a pas de sens sur des
mesures.

## Cadences de rafraîchissement

| Donnée | Cadence | Où |
|---|---|---|
| Résumé du parc | Calée sur `next_at` annoncé par le serveur | `useSummary.ts` |
| Détail des sites | Dans le même cycle que le résumé | `useSummary.ts` |
| Historique 24 h | 5 minutes | `useHistory.ts` |

Le serveur annonce dans `/api/consommations` l'heure de sa prochaine mesure
(`next_at`). Le client planifie son appel juste après, au lieu de sonder à
l'aveugle : une mesure arrive à l'écran deux à trois secondes après avoir
été collectée, pour un seul appel par cycle. Trois garde-fous encadrent ce
calcul : un repli à 60 secondes si le serveur n'annonce rien ou annonce une
heure illisible, un plafond à 60 secondes, et un plancher à 5 secondes qui
évite une rafale d'appels si les horloges divergent.

**Le résumé et le détail partent ensemble.** Les deux endpoints sont
rafraîchis par la même boucle côté serveur ; les charger dans le même cycle
garantit qu'un chiffre et son explication décrivent le même instant.
Changer d'onglet de site ne déclenche **aucun appel** : les sept détails
sont déjà chargés.

L'historique est au pas horaire : le rafraîchir plus souvent ne montrerait
rien de neuf, et la source régénère ses valeurs à chaque appel — la courbe
sauterait.

## Le détail par site

Le détail est une **liste de panneaux dépliants**, un site par ligne,
repliée par défaut. Trois règles en découlent.

**Chaque ligne porte ses propres données et son propre état.** Le composant
de ligne reçoit son site et calcule ce qu'il affiche. Un composant parent
qui rendrait le contenu à la place des lignes afficherait le même site dans
tous les panneaux ouverts — c'est le bug qu'a révélé l'ouverture multiple.

**L'état d'ouverture est local, jamais dérivé de la sélection courante.**
La sélection est remise à jour par le rafraîchissement automatique ; si
l'ouverture en dépendait, un panneau fermé par le lecteur se rouvrirait de
lui-même au cycle suivant. Tant que le lecteur n'a rien touché, l'ouverture
suit ce que désigne le parent ; au premier clic, elle lui appartient.

**Déplier ne déclenche aucun appel.** Les sept détails sont déjà chargés.

### Ce qu'affiche la case « Actuel »

Un chiffre n'est marqué comme daté que lorsqu'il **sort réellement de la
mémoire du back**, c'est-à-dire quand le résumé ne porte plus rien. Il est
alors affiché en ambre avec son heure : « Dernier relevé datant de 14h46 ».
Un tiret ne reste que si l'on n'a jamais rien mesuré.

### Les alertes

L'alerte la plus grave s'affiche dans un bandeau **au-dessus** du
graphique, jamais par-dessus : une alerte posée sur la courbe cache
précisément ce qu'elle commente. Les autres alertes du site sont listées
sous le graphique.

Le bandeau prend la couleur de la gravité — ambre pour une alerte moyenne,
rouge pour une critique — et le compteur du bandeau de tête suit la même
règle : neutre à zéro, ambre s'il n'y a que des alertes moyennes, rouge
seulement s'il existe une critique. Un compteur rouge en permanence
n'apprend rien et banalise les vraies urgences.

### Ce qui n'est pas affiché, et pourquoi

Deux champs ont été retirés volontairement. Le **facteur de puissance**,
parce qu'aucun seuil contractuel n'est connu et qu'un chiffre nu n'apprend
rien à qui lit l'écran. Le **coût du jour**, parce que l'API ne le fournit
pas et que le remplir exigerait d'inventer un tarif au kWh.

La règle est la même dans les deux cas : mieux vaut trois cartes justes que
quatre dont une vide. Une carte qui affiche `—` sur les sept sites fait
conclure à un lecteur que l'application ne marche pas.

Reste « Prévu +2 h » et « Mesures reçues », qui affichent encore `—` : la
première attend que le modèle soit branché, la seconde un calcul depuis
l'historique. Les deux ont leur ticket.

## Thème clair et thème sombre

Le thème est porté par des variables CSS redéfinies sous
`:root[data-theme="light"]`. **Aucune couleur n'est écrite en dur dans un
composant** : une classe comme `bg-[rgba(255,122,26,0.14)]` ne suivrait pas
le thème, et c'est exactement ce qui empêchait l'application d'en changer
vraiment.

| Variable | Rôle |
|---|---|
| `--accent` | La couleur de marque : chevron ouvert, puces numérotées |
| `--accent-doux` | Son aplat translucide, pour le fond d'un panneau ouvert |
| `--mesure` | La courbe de consommation |
| `--ambre`, `--danger` | Les signaux, jamais décoratifs |
| `--halo` | Le dégradé du fond de page |

Les couleurs de signal sont **ajustées par thème**, pas héritées : une
teinte pensée pour un fond sombre perd son contraste sur du blanc. Et elles
restent ambre et rouge dans les deux thèmes — on repère une alerte parce
qu'elle jure avec le reste, pas parce qu'elle s'y fond.

## Qualité de code

**Biome** lint et formate le front, comme ruff le fait pour le back : un
seul outil par langage plutôt qu'un linter, un formateur et un trieur
d'imports.

```bash
npm run lint        # vérifie
npm run lint:fix    # corrige ce qui peut l'être
```

La configuration est dans `biome.json`. Elle suit le style déjà en place —
deux espaces, pas de point-virgule, guillemets simples, 110 colonnes — et
non les réglages par défaut de Biome, qui reformateraient tout le dossier
sans rien apporter.

> Les fichiers créés ou copiés depuis Windows arrivent en CRLF et font
> échouer le formateur. `sed -i 's/\r$//' <fichier>` les remet en LF.

### Les exemptions

Une directive `biome-ignore` **doit porter une justification**. Sans raison
écrite, c'est une règle désactivée au hasard ; avec, c'est une décision que
le relecteur peut discuter. Il en reste une aujourd'hui :

**`Text.tsx` — `noArrayIndexKey`.** La règle est juste en général : un index
de tableau fait une mauvaise clé React quand la liste peut être réordonnée.
Ici les fragments viennent d'un `split` sur une chaîne et ne bougent jamais.

La directive doit tenir **sur une seule ligne**, immédiatement avant la
ligne concernée. Sur deux lignes, Biome l'ignore sans le signaler.

### Ce qu'aucun outil n'attrape

`tsc --noEmit` vérifie les types, Biome le style et quelques pièges
courants. Ni l'un ni l'autre ne voit :

- le **contenu des chaînes de caractères** — un texte d'interface cassé par
  un renommage, ou une URL d'endpoint erronée, reste valide pour le
  compilateur
- les **accès hors bornes** — `series[index]` est typé `SeriesPoint`, jamais
  `undefined`, et a déjà provoqué un écran blanc

C'est ce qui rend le passage à l'écran non négociable.

## Tests

Les tests vivent dans `src/tests/`, en miroir de l'arborescence du code :

```
src/tests/
├── api/
│   └── client.test.ts
├── components/
│   ├── ConsumptionChart.test.tsx
│   └── ui/
│       ├── Badge.test.ts
│       └── Text.test.tsx
├── screens/
│   ├── Dashboard.test.tsx
│   └── SiteDetail.test.tsx
└── services/
    ├── details.test.ts
    ├── format.test.ts
    ├── history.test.ts
    ├── normalize.test.ts
    ├── summary.test.ts
    ├── useHistory.test.ts
    └── useSummary.test.ts
```

Ils tournent avec **Vitest** et ne font **aucun appel réseau réel** : le
module `api/client` est simulé. Les composants sont montés avec Testing
Library dans un DOM jsdom.

```bash
npm test                  # une exécution complète
npm run test:coverage     # avec la couverture ; rapport HTML dans coverage/
```

Le script fixe `TZ=Europe/Paris`. Ce n'est pas décoratif : les fonctions de
formatage convertissent en heure locale, donc sans fuseau fixé les tests
passeraient sur une machine française et échoueraient en CI, qui tourne en
UTC.

Un test gagne à garder une décision plutôt qu'à vérifier une évidence. Les
plus utiles de cette suite vérifient qu'aucun chiffre ne s'affiche quand
l'API ne répond pas, qu'un site muet ne compte pas pour zéro dans le total
du parc, qu'un horodatage sans fuseau est bien lu comme de l'UTC, qu'un
détail de site indisponible n'efface pas le résumé, et qu'un chiffre du
cycle courant n'est pas annoncé comme périmé — cinq erreurs qui ont
réellement coûté du temps, ou qui auraient pu.

> Un test vert ne dit pas que la couverture a augmenté, et une couverture
> stable ne dit pas qu'un test est inutile. Huit tests ajoutés sur
> `SiteDetail` n'ont pas bougé le pourcentage d'un dixième : les lignes
> étaient déjà *exécutées* par d'autres tests, mais rien ne vérifiait ce
> qu'elles affichaient. Un pourcentage mesure le passage, pas la
> vérification.

### Tester un hook

Les hooks se testent avec `renderHook` et des temporisateurs simulés :

```ts
vi.useFakeTimers({ shouldAdvanceTime: true })
```

L'option `shouldAdvanceTime` n'est pas décorative : `waitFor` a lui-même
besoin que le temps avance, et sans elle il attendrait indéfiniment. Pour
franchir une échéance, `await vi.advanceTimersByTimeAsync(ms)`, qui laisse
aussi les promesses se résoudre.

Chaque hook vérifie au minimum qu'il n'appelle plus rien après le
démontage : un timer qui survit à son composant est une fuite silencieuse.

### Couverture

Les seuils sont dans `vitest.config.ts`. Le périmètre couvre **tout
`src/`**, fichiers non testés compris, à l'exception du point d'entrée, des
types et des données de démonstration : une couverture qui ne mesure que les
fichiers déjà testés ne mesure rien.

Le seuil est un cliquet, pas une cible : il est calé juste sous la
couverture constatée, pour interdire une régression sans forcer à écrire des
tests inutiles.

La CI (job `tests-front`) lance `npm run test:coverage` : un seuil non tenu
fait échouer la pull request.

### Ce qui n'est pas couvert

Le client HTTP étant simulé, **aucun test ne vérifie qu'une URL atteint
réellement le back**. Les tests vérifient le chemin demandé, pas qu'il
existe de l'autre côté. C'est exactement par là qu'est passé le bug du
dashboard affichant des données de démonstration, et seul un test de bout en
bout le fermerait.

## Avant de pousser

```bash
cd app/front
npm run lint
npx tsc --noEmit
npm run test:coverage
npm run build
```

`test:coverage` plutôt que `test` : c'est ce que lance la CI, et un seuil
non tenu ne se voit pas autrement.

Le `build` vérifie en plus que le bundle de production se construit : une
erreur qui ne gêne pas le serveur de développement peut le casser.

**Et regarder l'écran.** C'est la seule vérification qui attrape un texte
cassé, une couleur disparue ou une courbe qui part à l'envers. Aucun outil
ne la remplace.

## Mode strict de React

`main.tsx` enveloppe l'application dans `<StrictMode>`. En développement,
React monte puis démonte puis remonte chaque composant, ce qui **double les
appels réseau** au premier chargement. C'est voulu : cela révèle les effets
mal nettoyés.

En build de production, React ne double plus rien et le composant est
inerte. Pour le vérifier : `npm run build && npm run preview`.

Ne pas retirer `<StrictMode>` pour faire disparaître les appels doublés :
c'est le symptôme qu'on observe, pas le problème.
