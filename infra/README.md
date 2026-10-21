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

Pour les variables Terraform, regardez le fichier `variables.tf` et créez un fichier `terraform.tfvars` qui contient les différentes variables. Dans un terminal, à la racine du projet,

```powershell
cd infra/
terraform init
terraform plan
terraform apply
```

Quand la commande `terraform plan` est lancée, vous devez vous assurer que la ressource `rg-<strudent_id>_cours-projet-eadl` ne soit pas modifiée. Décommentez les lignes `# ippubnumber = "1"`, `# vmnumber = "1"`, `# namageddisknumber = "1"` et `# storageaccountnumber = "1"` si besoin.