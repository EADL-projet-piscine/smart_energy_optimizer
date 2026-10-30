# Rapport de sécurisation

## IaC
L'infrastructure est provisionnée via Terraform. Les fichiers sont découpés suivant l'organisation suivante.
- `data_factory.tf` : Création d'un Data Factory et d'un pipeline Data Factory
- `imports.tf` : L'import des ressources existantes
- `locales.tf` : Création des variables locales
- `main.tf` : Création des ressources principales
- `monitoring_vm.tf` : Installation de Grafana + Prometheus via un script
- `monitoring.tf` : Création des ressources pour le monitoring
- `outputs.tf` : Définition des sorties
- `providers` : Définition des providers
- `requetes.tf` : Création des requêtes pour Log Analytics
- `variables.tf` : Définition des variables

Les données sensibles sont définies dans `variables.tf` et peuvent être créées sous forme de variable d'environnement commençant par `TF_VAR` ou dans un fichier `terraform.tfvars`.

## Monitoring

Le monitoring repose sur deux briques complémentaires, toutes deux déployées par Terraform :
- **Azure Monitor** : les métriques et les logs du compte de stockage, de la Data Factory et de la VM sont envoyés dans un workspace **Log Analytics**, conservés 30 jours.
- **Prometheus et node_exporter**, installés dans la VM avec Docker : ils mesurent toutes les 15 secondes l'intérieur de la VM (CPU, mémoire, espace disque, réseau).

**Grafana**, installé lui aussi dans la VM, affiche ces deux sources dans deux tableaux de bord définis en code et chargés automatiquement.

### Ce qui est en place

![Liste des tableaux de bord Grafana](assets/dashboard.png)
*Les deux tableaux de bord du dossier Smart Energy.*

#### Tableau de bord « Services Azure »

![Métriques par Azure Monitor](assets/service_Azure.png)
*Dashboard des métriques de Azure Monitor.*

Il regroupe les exécutions et les erreurs des pipelines Data Factory, l'activité du compte de stockage, ainsi que le CPU et les crédits CPU de la VM mesurés par Azure.

#### Tableau de bord « VM applicative »

![Métriques par Prometheus](assets/vm_applicative.png)
*Dashboard des métriques de Prometheus.*

Il montre l'état de la VM vue de l'intérieur : utilisation du CPU, de la mémoire, de l'espace disque et du réseau.

Pendant un test de charge réalisé avec `stress-ng` : le CPU monte à 100 % puis redescend à la fin du test.

#### Requêtes enregistrées dans Log Analytics

![Requêtes enregistrées dans Arure](assets/journaux_dans_Azure.png)
*Requêtes de catégorie Smart Energy dans le Hub de requêtes Azure.*

Les requêtes KQL de surveillance sont aussi enregistrées dans le workspace Log Analytics (`requetes.tf`). Elles restent consultables depuis le portail Azure même si la VM, et donc Grafana, est arrêtée.

### Sécurité du monitoring

- Grafana et Prometheus n'écoutent que sur l'adresse locale de la VM : ils ne sont pas joignables depuis Internet, et aucun port supplémentaire n'est ouvert dans le NSG. On y accède par un **tunnel SSH chiffré** (`ssh -L 3000:localhost:3000 ...`), qui hérite des restrictions du SSH (clé et adresse IP).
- L'inscription libre à Grafana est désactivée. Le compte administrateur est protégé par un mot de passe fourni par une variable Terraform sensible.
- Grafana lit les données Azure avec l'identité managée de la VM, en lecture seule.

### Limites actuelles

1. **Droits limités de l'abonnement.** Les Data Collection Rules, les Action Groups, Azure Managed Grafana, les Workbooks et les tableaux de bord Azure partagés ne sont pas autorisés. Conséquences : l'agent Azure Monitor ne peut pas être installé dans la VM, et Azure ne peut envoyer aucune alerte.
2. **Pas de logs système ni de logs applicatifs.** La stack collecte des **métriques** (Prometheus) mais pas les **logs** de la VM (syslog) ni des conteneurs. Loki et Alloy ne sont pas installés.
3. **Pas d'alertes.** Le monitoring est consultatif : il faut ouvrir Grafana pour voir un problème, personne n'est prévenu automatiquement.
4. **Pas de traces.** Application Insights est déployé, mais le code de l'application n'est pas encore instrumenté pour lui envoyer ses traces et ses erreurs.
5. **Grafana sur la VM qu'il surveille.** Si la VM applicative s'arrête, le monitoring s'arrête avec elle, au moment précis où il serait le plus utile. Les requêtes enregistrées dans Log Analytics permettent toutefois de consulter les données Azure dans ce cas.
6. **Un seul compte Grafana.** Le compte `admin` est partagé : tout le monde a tous les droits, et on ne sait pas qui a fait quoi.
7. **Versions figées.** Elles garantissent la reproductibilité, mais ne reçoivent aucun correctif de sécurité tant qu'elles ne sont pas mises à jour.
### Pistes d'amélioration

- **Placer Grafana sur une VM dédiée** *(limite 5)*. C'est la bonne pratique : si la VM applicative tombe, Grafana reste disponible et montre la panne. Ce n'est pas possible ici, car l'abonnement n'autorise qu'**une seule adresse IP publique**, déjà attribuée à la VM applicative. Une VM de monitoring n'aurait qu'une adresse privée : pour l'atteindre, il faudrait rebondir en SSH par la VM applicative (`ssh -J`). Si la VM applicative tombe, cette porte d'entrée disparaît et la VM de monitoring devient injoignable, ce qui annule l'intérêt de la séparation. Placer l'IP publique sur la VM de monitoring ne convient pas non plus : l'application ne serait plus accessible depuis Internet.
- **Centraliser les logs avec Loki et Alloy** *(limite 2)*. **Loki** stocke et indexe les logs comme Prometheus le fait pour les métriques, et **Alloy**, l'agent de collecte de Grafana, lit les logs (syslog, journaux Docker, fichiers de l'application) et les envoie à Loki. Logs et métriques pourraient alors être consultés et croisés dans Grafana, sans dépendre des Data Collection Rules d'Azure.
- **Configurer l'alerting de Grafana** *(limites 1 et 3)*. Grafana sait envoyer des alertes (email, Teams...) sans passer par les Action Groups d'Azure, à condition de configurer un canal d'envoi.
- **Instrumenter l'application** *(limite 4)*. Avec la distribution OpenTelemetry d'Azure Monitor, quelques lignes dans le code suffisent pour envoyer traces, logs et erreurs à Application Insights.
- **Créer un compte par personne** *(limite 6)*, avec le rôle *Viewer* (lecture seule) pour la consultation.
- **Mettre à jour régulièrement les versions** *(limite 7)*, au moins vers la dernière version corrective, en modifiant `docker_version` et les images de `docker-compose.yml`, puis `terraform apply`.

## Sécurité Cloud

Les données sensibles sont définies en variables d'environnement. Celles-ci sont définies dans les secrets de GitHub Actions et dans des fichiers .env sur la machine virtuelle. Les droits de lecture et d'écriture sont limités avec une commande `chmod 600` pour que seul le propriétaire du fichier puisse écrire et lire ces fichiers. C'est le cas notamment des mots de passe pour la base de données.

L'accès réseau à la machine virtuelle est limité. La connexion en SSH sur le port 22 est limité à une seule adresse IP publique (celle du propriétaire de la machine virtuelle, définie pour le déploiement de la machine virtuelle avec Terraform). La connexion HTTP (port 80) et HTTPS (port 443) est ouvert à toutes les adresses IP.
