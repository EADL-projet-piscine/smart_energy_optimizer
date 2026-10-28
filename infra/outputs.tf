output "sa_name" {
  value = azurerm_storage_account.sa.name
}

output "public_ip" {
  value = azurerm_public_ip.public_ip.ip_address
}

# Adresse du dashboard en production : la valeur de SITE_DOMAIN dans le .env de la VM.
output "fqdn" {
  value = azurerm_public_ip.public_ip.fqdn
}

output "vm_name" {
  value = azurerm_linux_virtual_machine.applicatif-vm.name
}

# La "chaîne de connexion" que l'application Python utilisera pour
# envoyer ses données. Afficher avec : terraform output -raw appi_connection_string
output "appi_connection_string" {
  value     = azurerm_application_insights.appi.connection_string
  sensitive = true
}

# La commande à lancer sur votre PC pour ouvrir Grafana
output "grafana_tunnel" {
  value = "ssh -L 3000:localhost:3000 ${var.admin_username}@${azurerm_public_ip.public_ip.ip_address}  puis ouvrir http://localhost:3000"
}
