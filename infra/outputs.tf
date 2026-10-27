output "sa_name" {
  value = azurerm_storage_account.sa.name
}

output "public_ip" {
  value = azurerm_public_ip.public_ip.ip_address
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
