# IaC
L'infrastructure est provisionné via Terraform. Les fichiers sont découpés suivant l'organisation suivante.
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

# Monitoring

Grafana est installé sur la VM et donne accès à deux dashboards.

# Sécurité Cloud

Les données sensibles sont définies en variables d'environnement. Celles-ci sont définies dans les secrets de Github Actions et dans des fichiers .env sur la machine virtuelle. Les droits de lecture et d'écriture sont limités avec une commande `chmod 600` pour que seul le propriétaire du fichier puisse écrire et lire ces fichiers. C'est le cas notamment des mots de passe pour la base de données.

L'accès réseau à la machine virtuelle est limité. La connexion en SSH sur le port 22 est limité à une seule adresse IP publique (celle du propriétaire de la machine virtuelle, définie pour le déploiement de la machine virtuelle avec Terraform). La connexion HTTP (port 80) et HTTPS (port 443) est ouvert à toutes les adresses IP.
