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
(`useSummary`, `useHistory`, `useForecasts`, `useSession`) qui s'en charge.
Cela permet de tester toute la logique de données sans monter de composant.

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
├── screens/               Dashboard, SiteDetail, Login, Accounts
├── services/              Modèle, normalisation, formatage, hooks
│   ├── model.ts           Les types partagés
│   ├── normalize.ts       Lecture défensive du résumé de la source
│   ├── format.ts          Formatage et règles d'affichage
│   ├── series.ts          Opérations sur les séries datées
│   ├── summary.ts         ┐
│   ├── details.ts         │
│   ├── history.ts         │ un service par endpoint,
│   ├── forecasts.ts       │ plus son hook
│   ├── session.ts         │
│   ├── accounts.ts        ┘
│   ├── useSummary.ts
│   ├── useHistory.ts
│   ├── useForecasts.ts
│   ├── useSession.ts
│   └── useAccounts.ts
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

**Une heure seule ne suffit pas au-delà de la journée.** Les prévisions
portent sur 24 heures : « 14h00 » ne dit pas si c'est dans deux heures ou
dans vingt-deux, et se lit volontiers comme un moment déjà passé.
`formatDayHour()` ajoute « demain » dès qu'il ne s'agit plus d'aujourd'hui.
`formatHour()` reste juste pour les graduations du graphique, où l'axe porte
la chronologie.

**Un champ affiché a une seule source.** Deux endpoints qui servent la même
donnée, ce sont deux versions de la vérité, et c'est toujours celle qu'on ne
regarde pas qui est la bonne. Voir la section suivante.

## Endpoints consommés

| Service | Endpoint | Ce qu'il apporte |
|---|---|---|
| `summary.ts` | `GET /api/consommations` | le parc : totaux, consommation et capacité de chaque site, alertes |
| `details.ts` | `GET /api/consommations/sites` | par site : qualité de la mesure, causes d'absence, grandeurs électriques |
| `history.ts` | `GET /api/consommations/historique` | les 24 dernières heures, par site et pour le parc |
| `forecasts.ts` | `GET /api/previsions` | les prévisions à venir, par site et pour le parc |
| `session.ts` | `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout` | la session : faut-il se connecter, qui est connecté, quels sites il voit |
| `accounts.ts` | `GET`, `POST`, `PATCH /api/comptes` | les comptes : création, nom, rôle, sites, activation, mot de passe |

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

`/api/previsions` existe aussi en version par site
(`/api/previsions/{site_id}`), inutilisée : l'écran affiche le parc et les
sept sites ensemble, un seul appel suffit.

**Session.** `useSession` décide de l'écran : connexion ou dashboard. Le jeton
vit dans un cookie `HttpOnly` que le dashboard ne lit jamais ; `fetchJson`
l'envoie avec chaque appel. Une réponse 401, d'où qu'elle vienne (session
expirée au bout de 15 minutes), émet `UNAUTHORIZED_EVENT` et ramène à l'écran
de connexion. Si l'API est ouverte (`AUTH_ENABLED=false`) ou ne connaît pas
`/api/auth/me`, le dashboard s'affiche comme avant. Le filtrage par site est
fait par l'API : le dashboard affiche ce qu'il reçoit.

Les prévisions héritent de ce filtrage sans rien en savoir : un lecteur ne
reçoit que les prévisions de ses sites, et `sumBySite` n'additionne que
celles-là. Le total du parc d'un `viewer` est donc celui de **son** parc.

**Comptes.** `accounts.ts` et `useAccounts` servent le seul écran réservé à
un rôle. Le front cache le bouton aux non-administrateurs, mais c'est l'API
qui décide : elle répond 403, et un écran caché n'est pas un écran protégé.

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
`useSummary` les charge avec `Promise.allSettled` et non `Promise.all`. Les
prévisions suivent la même logique : leur absence laisse les mesures à
l'écran, avec un bandeau.

Les chemins sont écrits dans les services, jamais dans un composant. Ce sont
des **chaînes de caractères** : ni TypeScript ni Biome ne les vérifie, et une
faute de frappe produit un 404 que rien ne signale à la compilation. Après
toute modification d'un chemin, ouvrir `/docs` côté back pour comparer les
URL complètes, puis regarder l'onglet réseau du navigateur.

La convention de nommage des endpoints est décrite dans
`conventions-back.md` : collection au pluriel, vue calculée au singulier.

## Les séries datées

`services/series.ts` porte les trois opérations que l'historique et les
prévisions partagent.

**`sumBySite`** additionne les sites à horodatage égal. Un horodatage où
aucun site n'a de valeur reste à `null` : un site muet ne tire pas le total
du parc vers le bas. La fonction prend le champ à sommer — `measuredKw` ou
`forecastKw` — plutôt que d'exister en deux copies.

**`mergeSeries`** réunit mesures et prévisions en une seule série triée. Les
deux ne se chevauchent pas, l'historique s'arrêtant au présent, mais si un
horodatage leur est commun le point porte les deux valeurs au lieu
d'apparaître en double.

**`connectForecast`** raccorde la courbe de prévision à la dernière mesure.
Sans lui, la ligne démarre au premier créneau à venir et **flotte** : le
lecteur voit deux tracés sans lien alors qu'il s'agit de la même
consommation, avant et après maintenant. Le point de jonction porte les deux
valeurs, strictement égales — on ne prétend rien prévoir, on prolonge la
ligne jusqu'à ce qui est déjà constaté.

> Ce raccord a une conséquence qu'il faut connaître : le dernier point
> mesuré porte désormais une valeur de prévision. Tout calcul qui cherche un
> maximum prévu doit l'exclure, sous peine d'afficher un chiffre mesuré sous
> l'étiquette « prévu ». `SiteDetail` le fait, et un test l'épingle.

Les points d'historique tombent à des minutes non rondes — 09h32, 10h32 —
tandis que les prévisions sont à l'heure pile. Les deux séries ne se
superposent donc jamais, ce qui est sans gravité : elles ne couvrent pas la
même période.

## Graphiques

Les graphiques utilisent **Recharts**. Les couleurs passent par les
variables CSS du thème (`var(--mesure)`, `var(--prevision)`, `var(--ambre)`)
pour que le mode clair et le mode sombre fonctionnent sans JavaScript.

La ligne de repère trace la **capacité du site**, en ambre, la même couleur
que le bandeau d'alerte : les deux désignent la même limite, ils doivent se
répondre à l'œil. Elle n'est pas tracée sur le graphique du parc — la somme
des sept capacités est une limite théorique, jamais atteinte simultanément,
et le total affiché exclut les sites muets : comparer les deux ne compare
rien.

La courbe de prévision est en **tiretés**, comme la ligne de capacité. Sa
légende n'apparaît que lorsqu'une prévision existe : une entrée de légende
sans ligne envoie le lecteur chercher un tracé absent.

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
| Prévisions | 5 minutes | `useForecasts.ts` |

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

**Les prévisions suivent exactement la cadence de l'historique**, et c'est
délibéré : les deux séries sont tracées ensemble, et des rythmes différents
feraient apparaître une prévision plus récente que la mesure qu'elle
prolonge. Cinq minutes sont généreuses pour une donnée que le modèle produit
au mieux une fois par heure ; les ralentir imposerait de ralentir
l'historique d'autant.

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

### Les trois cases

Un panneau ouvert montre **Actuel**, **Capacité** et **Pic de consommation
prévu**. Elles se lisent ensemble : ce que le site consomme, ce qu'il peut
encaisser, et le plus haut qu'il atteindra.

Les trois sont **toujours présentes**, même quand l'une n'a rien à dire. Les
faire apparaître et disparaître selon le site donnerait des panneaux de
largeurs inégales dès que deux sont ouverts côte à côte.

### Ce qu'affiche la case « Actuel »

Un chiffre n'est marqué comme daté que lorsqu'il **sort réellement de la
mémoire du back**, c'est-à-dire quand le résumé ne porte plus rien. Il est
alors affiché en ambre avec son heure : « Dernier relevé datant de 14h46 ».
Un tiret ne reste que si l'on n'a jamais rien mesuré.

### Ce qu'affiche la case « Pic de consommation prévu »

Trois états, et non deux :

| Situation | Affiché | Pourquoi |
|---|---|---|
| maximum prévu ≥ 90 % de la capacité | la valeur, son heure, son pourcentage | il y a un pic, et il faut dire quand |
| maximum prévu sous le seuil | « Aucun », suivi de l'horizon couvert | annoncer un pic à 70 % crierait au loup |
| aucune prévision pour ce site | « — » | le modèle n'a pas tourné : ce n'est ni un pic ni son absence |

Le tiret est **réservé au dernier cas**. Une absence de pic n'est pas une
donnée manquante, et les confondre ferait conclure à une panne.

« Aucun » s'accompagne toujours de l'horizon — « jusqu'à demain 16h00 » —
sans quoi la réponse est à moitié dite : aucun pic jusqu'à quand ?

Les seuils sont ceux des alertes de capacité : 90 % en ambre, 100 % en
rouge. Un pic signalé autrement que la charge réelle ferait douter de l'un
ou de l'autre.

> **Ces seuils sont recopiés de `config.py`**, que l'API n'expose pas. Ils
> vivent dans `loadTone()`, dans `format.ts`, avec un commentaire qui le
> signale. Si quelqu'un change `ALERT_MEDIUM_PCT` côté back, le front mentira
> sans qu'aucun test ne le voie. Un ticket est ouvert pour les faire remonter
> dans la réponse de `/api/consommations`.

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

Quatre champs ont été retirés volontairement.

Le **facteur de puissance**, parce qu'aucun seuil contractuel n'est connu et
qu'un chiffre nu n'apprend rien à qui lit l'écran. Le **coût du jour**,
parce que l'API ne le fournit pas et que le remplir exigerait d'inventer un
tarif au kWh.

**« Prévu +2 h »** et **« Mesures reçues »**, parce qu'aucune source ne les
alimentait : `forecast2hKw` se calcule depuis `site.series`, toujours vide,
et `receivedCount` n'est renseigné par rien. Elles affichaient un tiret sur
les sept sites. Le ticket qui devait brancher « Mesures reçues » depuis
`/readings` reste ouvert, mais il s'intitule désormais « ajouter la case »
et non « la brancher ».

La règle est la même dans les quatre cas : mieux vaut trois cartes justes
que cinq dont deux vides. Une carte qui affiche `—` sur les sept sites fait
conclure à un lecteur que l'application ne marche pas.

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
| `--prevision` | La courbe de prévision, en tiretés |
| `--seuil` | La ligne de capacité d'un site |
| `--ambre`, `--danger` | Les signaux, jamais décoratifs |
| `--halo` | Le dégradé du fond de page |

Les couleurs de signal sont **ajustées par thème**, pas héritées : une
teinte pensée pour un fond sombre perd son contraste sur du blanc. Et elles
restent ambre et rouge dans les deux thèmes — on repère une alerte parce
qu'elle jure avec le reste, pas parce qu'elle s'y fond.

`--prevision` vaut orange sur fond sombre et vert sapin sur fond clair, dans
les deux cas franchement distinct de `--mesure`. Sur le thème sombre, cette
teinte voisine l'ambre des alertes et le rouge du seuil, lui aussi tracé en
tiretés : à surveiller sur le graphique d'un site, où les deux lignes se
croisent quand la prévision dépasse la capacité.

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

### La cible TypeScript

`tsconfig` vise **ES2022**. Les méthodes plus récentes existent à
l'exécution — `findLast`, `findLastIndex`, `Object.groupBy` — mais `tsc` les
refuse, et **Vitest ne le voit pas** : il transpile sans vérifier les types.
Un code fautif passe donc tous les tests en local et fait échouer la CI, qui
lance `npm run build`.

Deux de ces méthodes s'étaient glissées dans `series.ts` et `SiteDetail.tsx`.
Elles ont été remplacées par des boucles, sur le modèle de
`lastMeasuredIndex()` qui existait déjà — plutôt que de relever la cible du
projet entier pour deux appels.

**Lancer `npx tsc --noEmit` avant de pousser** est la seule façon de voir ce
que `npm test` laisse passer.

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
│   ├── Accounts.test.tsx
│   ├── Dashboard.test.tsx
│   ├── Login.test.tsx
│   └── SiteDetail.test.tsx
└── services/
    ├── accounts.test.ts
    ├── details.test.ts
    ├── forecasts.test.ts
    ├── format.test.ts
    ├── history.test.ts
    ├── normalize.test.ts
    ├── series.test.ts
    ├── session.test.ts
    ├── summary.test.ts
    ├── useAccounts.test.ts
    ├── useForecasts.test.ts
    ├── useHistory.test.ts
    ├── useSession.test.ts
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

**Un test ne doit pas dépendre du jour où il tourne.** `formatDayHour` prend
un paramètre `now` injectable pour cette raison : sans lui, un test écrit le
27 octobre afficherait « demain 14h00 » le 28 et échouerait. Les tests
d'écran qui cherchent une heure utilisent une expression régulière plutôt
qu'une chaîne exacte, la datation étant vérifiée là où elle vit.

Un test gagne à garder une décision plutôt qu'à vérifier une évidence. Les
plus utiles de cette suite vérifient qu'aucun chiffre ne s'affiche quand
l'API ne répond pas, qu'un site muet ne compte pas pour zéro dans le total
du parc, qu'un horodatage sans fuseau est bien lu comme de l'UTC, qu'un
détail de site indisponible n'efface pas le résumé, qu'un chiffre du cycle
courant n'est pas annoncé comme périmé, et que le point de jonction d'une
courbe n'est pas pris pour un pic prévu — six erreurs qui ont réellement
coûté du temps, ou qui auraient pu.

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

**Un écran qui consomme un nouveau hook doit le simuler dans ses tests.**
`Dashboard.test.tsx` simule `useSummary`, `useHistory`, `useForecasts` et
`useSession` : en oublier un laisserait le vrai hook partir sur le réseau
depuis un test.

Un hook simulé est aussi le seul moyen de tester un écran protégé sans
monter une session : `useSession` rendu avec un utilisateur donné place
l'écran dans l'état voulu, rôle compris.

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
erreur qui ne gêne pas le serveur de développement peut le casser. C'est
aussi lui qui lance `tsc --noEmit`, d'où l'intérêt de le faire avant.

**Et regarder l'écran.** C'est la seule vérification qui attrape un texte
cassé, une couleur disparue ou une courbe qui part à l'envers. Aucun outil
ne la remplace.

> Pour voir les prévisions à l'écran, la base doit en contenir :
> `db/seeds/dev_forecasts.sql` en pose un jeu. Il se rejoue, et son horizon
> part de l'heure où on l'applique — un jeu posé hier ne montre plus grand
> chose aujourd'hui.

## Mode strict de React

`main.tsx` enveloppe l'application dans `<StrictMode>`. En développement,
React monte puis démonte puis remonte chaque composant, ce qui **double les
appels réseau** au premier chargement. C'est voulu : cela révèle les effets
mal nettoyés.

En build de production, React ne double plus rien et le composant est
inerte. Pour le vérifier : `npm run build && npm run preview`.

Ne pas retirer `<StrictMode>` pour faire disparaître les appels doublés :
c'est le symptôme qu'on observe, pas le problème.
