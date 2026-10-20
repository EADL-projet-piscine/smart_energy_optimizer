import {
  to = azurerm_resource_group.rg
  id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.resource_group_name}"
}

import {
  to = azurerm_virtual_network.vnet
  id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.resource_group_name}/providers/Microsoft.Network/virtualNetworks/vnet-${var.student_id}"
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
  }
}

resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-${var.student_id}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "francecentral"
  address_space       = [var.vnet_address_space]

  tags = {
    user = var.student_id
  }
}