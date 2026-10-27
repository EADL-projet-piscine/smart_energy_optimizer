# Chaîne de caractères aléatoire pour la création d'un nom de compte de stockage
resource "random_string" "name" {
  length  = 8
  special = false
  upper   = false
  lower   = false
  numeric = true
}

# Crée un compte de stockage (storage account)
resource "azurerm_storage_account" "sa" {
  name                     = "${var.sa_name}${random_string.name.result}"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  # Identité managée : le compte accède aux autres services Azure sans clé ni mot de passe.
  identity {
    type = "SystemAssigned"
  }

  tags = {
    user = var.student_id
  }
}

# Crée un conteneur privé qui va contenir les données brutes
resource "azurerm_storage_container" "landing" {
  name                  = "landing"
  storage_account_name  = azurerm_storage_account.sa.name
  container_access_type = "private"
}

# Crée des règles réseau pour le compte de stockage
resource "azurerm_storage_account_network_rules" "nr" {
  storage_account_id = azurerm_storage_account.sa.id

  default_action             = "Deny"
  ip_rules                   = [var.ip]
  virtual_network_subnet_ids = [azurerm_subnet.subnet.id]
  bypass                     = ["Metrics", "AzureServices"]
}

# Crée une adresse IP publique pour la VM
resource "azurerm_public_ip" "public_ip" {
  name                = "applicatif-pip-vm-tf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
  # Nom DNS <label>.<région>.cloudapp.azure.com : Let's Encrypt ne délivre un certificat
  # qu'à un nom de domaine. Voir l'output fqdn et deploy/Caddyfile.
  domain_name_label = "enervision-${var.student_id}"

  tags = {
    user = var.student_id
  }
}

# Crée une interface réseau
resource "azurerm_network_interface" "nic" {
  name                = "nic-vm-tf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.241.${var.address_index}.4"
    # IP publique voulue : c'est par elle que l'on accède à la VM en SSH depuis son poste.
    # Le groupe de sécurité ci-dessous limite le port 22 à la seule adresse var.ip.
    public_ip_address_id = azurerm_public_ip.public_ip.id
  }

  tags = {
    user = var.student_id
  }
}

# Crée une VM Linux pour le bloc applicatif
resource "azurerm_linux_virtual_machine" "applicatif-vm" {
  name                = "applicatif-vm"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  size                = "Standard_B2s"
  admin_username      = var.admin_username
  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  # Identité managée : la VM accède aux autres services Azure sans clé ni mot de passe.
  identity {
    type = "SystemAssigned"
  }

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(pathexpand("~/.ssh/id_rsa.pub"))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  tags = {
    user = var.student_id
  }
}

# Crée un groupe de sécurité
resource "azurerm_network_security_group" "nsg" {
  name                = "nsg-vm-tf"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {
    name                       = "Allow-SSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.ip
    destination_address_prefix = "*"
  }

  # Le dashboard est un service public : HTTPS depuis Internet. Seul le conteneur
  # Caddy publie ces ports ; la base, l'API et le ML restent sur le réseau Docker.
  # Exception Trivy : exposition voulue du frontal HTTPS, seul service public.
  # trivy:ignore:AVD-AZU-0047
  security_rule {
    name                       = "Allow-HTTPS"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  # HTTP : Let's Encrypt y vérifie le domaine, et Caddy redirige tout le reste vers
  # le HTTPS. Aucun contenu n'est servi en clair.
  # Exception Trivy : validation Let's Encrypt et redirection vers le HTTPS.
  # trivy:ignore:AVD-AZU-0047
  security_rule {
    name                       = "Allow-HTTP-ACME"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  tags = {
    user = var.student_id
  }
}

# Crée une association entre le groupe de sécurité et l'interface réseau
resource "azurerm_network_interface_security_group_association" "association" {
  network_interface_id      = azurerm_network_interface.nic.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}
