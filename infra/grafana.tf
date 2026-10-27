# =====================================================================
# TEST : Azure Managed Grafana
# Ce service n'est pas dans la liste des services autorisés du cours.
# Ce fichier sert à vérifier s'il est bloqué ou non.
#
# ⚠️ Grafana est facturé à l'heure tant qu'il existe : si le test réussit
# mais que vous ne l'utilisez pas, supprimez-le (voir explications).
# =====================================================================

# Récupère des infos sur VOUS (le compte connecté avec az login),
# notamment votre identifiant, pour vous donner l'accès à Grafana.
data "azurerm_client_config" "current" {}

# ---------------------------------------------------------------------
# 1. L'instance Grafana
# ---------------------------------------------------------------------
resource "azurerm_dashboard_grafana" "grafana" {
  name                          = "grafana-${random_string.name.result}" # 2 à 23 caractères
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = azurerm_resource_group.rg.location
  sku                           = "Standard"
  public_network_access_enabled = true

  # Identité managée : Grafana s'en sert pour lire les données Azure
  # sans mot de passe (même principe que pour votre VM).
  identity {
    type = "SystemAssigned"
  }

  tags = {
    user = var.student_id
  }
}

# ---------------------------------------------------------------------
# 2. Les autorisations
#    Sans elles, Grafana existe mais ne sert à rien :
#    - Grafana doit avoir le droit de LIRE vos métriques et logs ;
#    - VOUS devez avoir le droit de vous CONNECTER à Grafana.
#    Ces attributions de rôle peuvent elles aussi être bloquées par l'école.
# ---------------------------------------------------------------------

# Grafana peut lire les données de monitoring de votre groupe de ressources
resource "azurerm_role_assignment" "grafana_lecture" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Monitoring Reader"
  principal_id         = azurerm_dashboard_grafana.grafana.identity[0].principal_id
}

# Vous êtes administratrice de votre Grafana
resource "azurerm_role_assignment" "grafana_admin_moi" {
  scope                = azurerm_dashboard_grafana.grafana.id
  role_definition_name = "Grafana Admin"
  principal_id         = data.azurerm_client_config.current.object_id
}

# L'adresse web de votre Grafana, affichée à la fin de l'apply
output "grafana_url" {
  value = azurerm_dashboard_grafana.grafana.endpoint
}
