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

## Structure

```
src/
├── api/client.ts          Appel HTTP unique, délai d'expiration, erreurs
├── components/            Composants réutilisables
│   ├── ui/                Briques génériques : Card, Metric, Tabs, Toast…
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
identifiants.

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
sans fuseau alors qu'il s'agit d'UTC, et `/readings` avec un `Z`.
`toIsoUtc()` normalise les deux. Sans cela, JavaScript lit un horodatage nu
comme de l'heure locale et affiche deux heures de moins en France, sans
erreur.

**Un point de série est daté, pas numéroté.** `SeriesPoint` porte `at`, une
chaîne ISO. Un entier d'heure ne distingue pas 9h hier de 9h aujourd'hui :
sur une fenêtre glissante, trier par heure relie deux points séparés de
vingt-trois heures.

## Graphiques

Les graphiques utilisent **Recharts**. Les couleurs passent par les
variables CSS du thème (`var(--mesure)`, `var(--seuil)`) pour que le mode
clair et le mode sombre fonctionnent sans JavaScript.

`connectNulls` reste à `false` : une mesure absente doit couper la courbe.

`type="monotone"` sur les courbes : l'interpolation ne dépasse jamais les
points de données. Les autres modes de lissage peuvent faire monter la
courbe au-dessus de la valeur réelle, ce qui n'a pas de sens sur des
mesures.

## Cadences de rafraîchissement

| Donnée | Cadence | Où |
|---|---|---|
| Résumé temps réel | Calée sur `next_at` annoncé par le serveur | `useSummary.ts` |
| Historique 24 h | 5 minutes | `useHistory.ts` |

Le serveur annonce dans `/resume` l'heure de sa prochaine mesure
(`next_at`). Le client planifie son appel juste après, au lieu de sonder à
l'aveugle : une mesure arrive à l'écran deux à trois secondes après avoir
été collectée, pour un seul appel par cycle.

L'historique est au pas horaire : le rafraîchir plus souvent ne montrerait
rien de neuf, et la source régénère ses valeurs à chaque appel — la courbe
sauterait.

## Tests

Les tests vivent dans `src/tests/`, en miroir de l'arborescence du code :

```
src/tests/
└── services/
    ├── format.test.ts
    └── history.test.ts
```

Ils tournent avec **Vitest** et ne font **aucun appel réseau réel** : le
module `api/client` est simulé.

```bash
npm test
```

Le script fixe `TZ=Europe/Paris`. Ce n'est pas décoratif : les fonctions de
formatage convertissent en heure locale, donc sans fuseau fixé les tests
passeraient sur une machine française et échoueraient en CI, qui tourne en
UTC.

## Avant de pousser

```bash
cd app/front
npx tsc --noEmit
npm test
npm run build
```

`tsc` attrape les erreurs de type, mais **pas** les chaînes de caractères,
ni les accès hors bornes de tableau (`series[index]` est typé `SeriesPoint`,
jamais `undefined`). Les deux ont déjà causé des bugs.

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
