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

Pour la VM, il faut créer une clé SSH. Sur une console Powershell, effectuez les commandes suivantes :
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
> Quand la commande `terraform plan` est lancée, vous devez vous assurer que la ressource `rg-<strudent_id>_cours-projet-eadl` ne soit pas modifiée.
>
> Décommentez les lignes `# ippubnumber = "1"`, `# vmnumber = "1"`, `# namageddisknumber = "1"` et `# storageaccountnumber = "1"` si besoin.

# Important

## Ce qui est en place
Le monitoring est déployé avec Terraform et centralisé dans un workspace Log Analytics :
- **Métriques** : VM (CPU, réseau, disques, crédits CPU), compte de stockage et Data Factory.
- **Logs** : opérations sur le compte de stockage (lecture, écriture, suppression) et exécutions des pipelines Data Factory.
- **Application Insights** : déployé et relié au workspace, prêt à recevoir les données de l'application.
- **Requêtes enregistrées** : les requêtes de surveillance sont définies en Terraform et disponibles dans le workspace.

## Limites actuelles
- **Traces** : elles ne sont pas encore collectées. Elles nécessitent d'instrumenter le code de l'application pour qu'elle envoie ses traces, logs et erreurs vers Application Insights. C'est la prochaine étape.
- **Intérieur de la VM** : l'agent Azure Monitor n'a pas pu être déployé (création de Data Collection Rules non autorisée). Les métriques de la VM sont donc vues uniquement depuis l'hôte : pas d'espace disque, pas de logs système (syslog).
- **Alertes** : aucune notification automatique n'est possible, la création d'Action Groups n'étant pas autorisée. Le monitoring est consultatif.

## Tableaux de bord
Plusieurs solutions ont été testées : Azure Workbooks, Azure Managed Grafana et les tableaux de bord Azure partagés (y compris via Terraform à partir d'un export JSON). Aucune n'a été possible compte tenu des droits limités fournis par l'organisation.

En remplacement, la visualisation s'appuie sur les requêtes enregistrées du workspace et sur un tableau de bord Azure personnel, configuré manuellement.

### Comment accéder aux requêtes enregistrées

Les requêtes sont générés via le fichier `requetes.tf`.

Pour les retrouver dans Azure :
1. Aller dans le `low-monitoring-xxxxxxxx`
2. Dans le panneau latéral gauche, trouver `Journaux`
3. Si `Agent` est coché en haut à droite, décocher l'option. Il est recommendé d'utiliser le mode KQL à la place du mode Simple
4. En haut à droite, cliquer sur `Hub de requêtes`
5. Une page `Queries hub` s'est ouverte, changer la `Catégorie` et sélectionner `Catégorie héritée`
6. Vous retrouverez toutes les requêtes créées dans la catégorie `Smart Energy`
