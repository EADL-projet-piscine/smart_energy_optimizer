output "sa_name" {
  value = azurerm_storage_account.sa.name
}

output "public_ip" {
  value = azurerm_public_ip.public_ip.ip_address
}

output "vm_name" {
  value = azurerm_linux_virtual_machine.applicatif-vm.name
}
