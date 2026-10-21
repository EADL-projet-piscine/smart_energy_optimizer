import {
  to = azurerm_resource_group.rg
  id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.resource_group_name}"
}

import {
  to = azurerm_virtual_network.vnet
  id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.resource_group_name}/providers/Microsoft.Network/virtualNetworks/vnet-${var.student_id}"
}

import {
    to = azurerm_subnet.subnet
    id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.resource_group_name}/providers/Microsoft.Network/virtualNetworks/vnet-${var.student_id}/subnets/snet-workload"
}

resource "azurerm_resource_group" "rg" {
  name = local.resource_group_name
  location = "francecentral"

  tags = {
    BypassPermAllRestrict = false
    BypassTempAllRestrict = false
    cours = "cours-projet-eadl"
    promotion = "READL_006"
    user = var.student_id
    # ippubnumber = "1"
    # vmnumber = "1"
    # namageddisknumber = "1"
    # storageaccountnumber = "1"
  }
}

resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-${var.student_id}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "francecentral"
  address_space       = ["10.241.${var.address_index}.0/24"]

  tags = {
    user = var.student_id
  }
}

resource "azurerm_subnet" "subnet" {
  name                 = "snet-workload"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.241.${var.address_index}.0/24"]
  enforce_private_link_endpoint_network_policies = true
  service_endpoints = ["Microsoft.Storage"]
}