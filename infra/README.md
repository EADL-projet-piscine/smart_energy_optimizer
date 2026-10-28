# Installation de Terraform
## Windows
- Téléchargez l'archive [ici](https://developer.hashicorp.com/terraform/install).
- Décompressez l'archive et enregistrez le chemin vers `terraform.exe` dans les variables d'environnement système `Path`.
- Vérifiez que l'installation s'est bien faite avec `terraform --version`

# Mise en place de l'infrastructure

Il faut enregistrer l'ID de l'abonnement en variable d'environnement. Pour trouver celui-ci, connectez-vous sur le [portail Azure](https://portal.azure.com/#home) et cliquez sur "Tous les services". Cherchez le service "Abonnements" et cliquez dessus. Vous trouvez l'ID de l'abonnement. Vous pouvez aussi installer Azure CLI pour obtenir l'ID de l'abonnement.
```powershell
Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\AzureCLI.msi; Start-Process msiexec.exe -Wait -ArgumentList '/I AzureCLI.msi /quiet'; rm .\AzureCLI.msi
az login
```

Ensuite enregistrez la variable d'environnement `ARM_SUBSCRIPTION_ID`.
```powershell
$Env:ARM_SUBSCRIPTION_ID= "<SUBSCRIPTION_ID>"
```

Pour la VM, il faut créer une clé SSH. Sur une console PowerShell, effectuez les commandes suivantes :
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.ssh"
ssh-keygen -t rsa -b 4096
```

Pour les variables Terraform, regardez le fichier `variables.tf` et créez un fichier `terraform.tfvars` qui contient les différentes variables. Dans un terminal, à la racine du projet, vous pouvez exécuter cette commande pour initialiser le fichier `terraform.tfvars` à partir d'un exemple :
```
cd infra/
cp terraform.tfvars.example terraform.tfvars
```

> [!TIP]
> Pour la variable `ip`, exécuter dans un terminal PowerShell
> ```
> (Invoke-RestMethod -Uri "https://api.ipify.org")
> ```

À partir du dossier `infra`, exécuter ces commandes
```powershell
terraform init
terraform plan
terraform apply
```

> [!WARNING]
>
> Quand la commande `terraform plan` est lancée, vous devez vous assurer que la ressource `rg-<student_id>_cours-projet-eadl` ne soit pas modifiée.
>
> Décommentez les lignes `# ippubnumber = "1"`, `# vmnumber = "1"`, `# namageddisknumber = "1"` et `# storageaccountnumber = "1"` si besoin.

# Monitoring

## Architecture

Le monitoring repose sur deux briques complémentaires, toutes deux déployées par Terraform :

| Brique | Ce qu'elle surveille | Où la consulter |
|---|---|---|
| **Azure Monitor** (workspace Log Analytics `law-monitoring-xxxxxxxx`) | Data Factory, compte de stockage, VM vue depuis Azure | Portail Azure et Grafana |
| **Prometheus + node_exporter** (dans la VM) | L'intérieur de la VM : CPU, mémoire, espace disque, réseau | Grafana |
| **Grafana** (dans la VM) | Affiche les deux sources dans des tableaux de bord | `http://localhost:3000` via un tunnel SSH |

Organisation des fichiers :
```
smart_energy_optimizer/
├── monitoring-stack/                 # stack installée dans la VM
│   ├── docker-compose.yml            # Prometheus, Grafana, node_exporter
│   ├── prometheus/prometheus.yml     # ce que Prometheus récolte
│   └── grafana/
│       ├── provisioning/             # sources de données et chargement des tableaux de bord
│       └── dashboards/               # tableaux de bord au format JSON
└── infra/
    ├── monitoring.tf                 # workspace, diagnostics, App Insights, rôle de lecture
    ├── requetes.tf                   # requêtes KQL enregistrées dans le workspace
    ├── monitoring_vm.tf              # installation de la stack dans la VM
    └── scripts/install_monitoring.sh.tftpl
```

## Ce qui est en place

- **Métriques Azure** : VM (CPU, réseau, disques, crédits CPU), compte de stockage et Data Factory, envoyées dans le workspace Log Analytics.
- **Logs Azure** : opérations sur le compte de stockage (lecture, écriture, suppression) et exécutions des pipelines Data Factory (pipelines, activités, déclencheurs).
- **Intérieur de la VM** : node_exporter et Prometheus mesurent toutes les 15 secondes le CPU, la mémoire, l'espace disque et le réseau. Les mesures sont conservées 15 jours.
- **Tableaux de bord Grafana**, définis en code et chargés automatiquement dans le dossier `Smart Energy` :
  - **Santé de la VM applicative** : tableau de bord communautaire *Node Exporter Full* (n°1860), téléchargé par la VM et renommé.
  - **Pipeline de données : ingestion et stockage** : exécutions et erreurs des pipelines Data Factory, activité du compte de stockage, CPU et crédits CPU de la VM vus par Azure.
- **Application Insights** : déployé et relié au workspace, prêt à recevoir les données de l'application.
- **Requêtes enregistrées** : les requêtes de surveillance sont définies en Terraform et disponibles dans le workspace.
### Installation automatique dans la VM

Grafana, Prometheus et node_exporter sont installés par Terraform grâce à l'extension Azure *Custom Script* (`monitoring_vm.tf`). Le script :
1. installe Docker depuis son dépôt officiel, en vérifiant sa signature, dans la version définie par `docker_version` ;
2. bloque cette version (`apt-mark hold`) pour qu'une mise à jour système ne la change pas ;
3. dépose les fichiers de `monitoring-stack` dans `/opt/monitoring-stack` et lance les conteneurs.
Toute modification d'un fichier de `monitoring-stack` est détectée par Terraform : un `terraform apply` relance le script et met la stack à jour, sans recréer la VM.

Grafana lit les données Azure avec l'identité managée de la VM, qui a le rôle **Monitoring Reader** (lecture seule) sur le groupe de ressources. Aucun mot de passe Azure n'est stocké.

## Accéder à Grafana

Grafana n'est pas exposé sur Internet : on y accède par un tunnel SSH.

1. Dans un terminal PowerShell, ouvrir le tunnel et **laisser la fenêtre ouverte** (la commande exacte est affichée par `terraform output grafana_tunnel`) :
```powershell
   ssh -L 3000:localhost:3000 <admin_username>@<ip_publique_de_la_vm>
```
2. Ouvrir [http://localhost:3000](http://localhost:3000) dans le navigateur.
3. Se connecter avec l'utilisateur `admin` et le mot de passe `grafana_admin_password`.
4. Aller dans `Dashboards`, dossier `Smart Energy`.
> [!NOTE]
> Le mot de passe n'est utilisé qu'au premier démarrage de Grafana. Pour le changer ensuite, passer par l'interface : profil en haut à droite, `Change password`.

### Vérifier l'installation

Sur la VM :
```bash
cd /opt/monitoring-stack
sudo docker compose ps                           # 3 conteneurs "Up"
curl -s http://localhost:3000/api/health         # "database": "ok"
docker --version && apt-mark showhold            # version figée de Docker
```

### Comment accéder aux requêtes enregistrées

Les requêtes sont générés via le fichier `requetes.tf`.

Pour les retrouver dans Azure :
1. Aller dans le `low-monitoring-xxxxxxxx`
2. Dans le panneau latéral gauche, trouver `Journaux`
3. Si `Agent` est coché en haut à droite, décocher l'option. Il est recommendé d'utiliser le mode KQL à la place du mode Simple
4. En haut à droite, cliquer sur `Hub de requêtes`
5. Une page `Queries hub` s'est ouverte, changer la `Catégorie` et sélectionner `Catégorie héritée`
6. Vous retrouverez toutes les requêtes créées dans la catégorie `Smart Energy`

## Tester le monitoring (test de charge)

Sur la VM, `stress-ng` permet de provoquer une charge et de la voir apparaître dans Grafana (période `Last 15 minutes`, actualisation `10s`) :
```bash
sudo apt-get install -y stress-ng
stress-ng --cpu 2 --timeout 3m                       # processeur
stress-ng --vm 1 --vm-bytes 1500M --timeout 2m       # mémoire (rester sous la mémoire disponible : free -h)
stress-ng --hdd 1 --hdd-bytes 1G --timeout 2m        # disque
```

> [!WARNING]
> La VM B2s consomme ses crédits CPU sous forte charge : garder des tests courts, et prévenir le groupe car l'application sera ralentie pendant le test.

Prometheus affiche la charge presque en temps réel. Les métriques Azure arrivent avec 5 à 15 minutes de retard.

## Limites actuelles

- **Traces** : elles ne sont pas encore collectées. Elles nécessitent d'instrumenter le code de l'application pour qu'elle envoie ses traces, logs et erreurs vers Application Insights. C'est la prochaine étape.
- **Logs système de la VM** : l'agent Azure Monitor n'a pas pu être déployé (création de Data Collection Rules non autorisée). node_exporter couvre les métriques internes (mémoire, espace disque), mais les logs système (syslog) ne sont pas collectés.
- **Alertes** : aucune notification automatique n'est en place. La création d'Action Groups Azure n'est pas autorisée. Une piste serait l'alerting de Grafana, qui demande de configurer un canal d'envoi (email, Teams...).
- **Disponibilité** : Grafana et Prometheus tournent sur la VM qu'ils surveillent. Si elle s'arrête, Grafana devient inaccessible ; les données Azure restent consultables dans le portail.
### Tableaux de bord natifs Azure

Plusieurs solutions natives ont été testées : Azure Workbooks, Azure Managed Grafana et les tableaux de bord Azure partagés (y compris via Terraform à partir d'un export JSON). Aucune n'a été possible compte tenu des droits limités fournis par l'organisation (erreurs `AuthorizationFailed`). C'est ce qui a conduit à héberger Grafana dans la VM.

## Sécurité

**Mesures en place :**
- Grafana et Prometheus n'écoutent que sur `127.0.0.1` : ils ne sont pas joignables depuis Internet. Le NSG n'ouvre que le port SSH, pour une seule IP. L'accès passe par un tunnel SSH chiffré.
- L'accès de Grafana à Azure se fait par identité managée, avec un rôle en lecture seule limité au groupe de ressources.
- Le script d'installation est envoyé en `protected_settings` (chiffré par Azure), le fichier `.env` n'est lisible que par root et le mot de passe Grafana est marqué `sensitive` dans Terraform.
- Docker est installé depuis le dépôt officiel avec vérification de la signature GPG. Toutes les versions sont figées (Docker, images Grafana, Prometheus et node_exporter, provider azurerm) pour une installation reproductible.
- L'inscription libre à Grafana est désactivée.
Vérification que Grafana n'est pas exposé (depuis le poste, sans tunnel) :
```powershell
Test-NetConnection <ip_publique_de_la_vm> -Port 3000   # TcpTestSucceeded : False
```

**Points d'amélioration :**
- Les versions figées doivent être mises à jour régulièrement (dernière version corrective) en modifiant `docker_version` et les images de `docker-compose.yml`, puis `terraform apply`.
- Un seul compte `admin` est partagé : il faudrait un compte par personne, en lecture seule (rôle *Viewer*) pour la consultation.
- Seuls Docker Engine et son client sont figés ; `containerd` et le plugin `compose` suivent la version disponible.
