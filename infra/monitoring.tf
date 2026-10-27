# =====================================================================
# MONITORING de l'infrastructure — version adaptée aux droits du cours
# Autorisé : Log Analytics, App Insights, paramètres de diagnostic.
# Non autorisé : Data Collection Rules, Action Groups (donc pas d'agent
# dans la VM ni d'alertes par email).
# =====================================================================

# ---------------------------------------------------------------------
# 1. L'ENTREPÔT DE LOGS : Log Analytics workspace
#    Toutes les données de monitoring sont envoyées ici, et on les
#    interroge avec le langage KQL (portail Azure > workspace > Logs).
# ---------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-monitoring-${random_string.name.result}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018" # facturation au Go ingéré
  retention_in_days   = 30          # 30 jours = durée de conservation incluse

  tags = {
    user = var.student_id
  }
}

# ---------------------------------------------------------------------
# 2. MÉTRIQUES DE LA VM
#    Sans agent, on ne voit pas "l'intérieur" de la VM (mémoire, logs
#    système), mais Azure mesure déjà de l'extérieur le CPU, le réseau et
#    les disques. On envoie ces métriques dans le workspace pour pouvoir
#    les requêter et les garder 30 jours (table AzureMetrics).
# ---------------------------------------------------------------------
resource "azurerm_monitor_diagnostic_setting" "vm" {
  name                       = "diag-vm-to-law"
  target_resource_id         = azurerm_linux_virtual_machine.applicatif-vm.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id

  metric {
    category = "AllMetrics"
  }
}

# ---------------------------------------------------------------------
# 3. LOGS DU COMPTE DE STOCKAGE
#    On cible le service Blob, qui porte le conteneur "landing".
#    Table dans le workspace : StorageBlobLogs
# ---------------------------------------------------------------------
resource "azurerm_monitor_diagnostic_setting" "sa_blob" {
  name                       = "diag-blob-to-law"
  target_resource_id         = "${azurerm_storage_account.sa.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id

  # Qui lit, écrit, supprime des fichiers dans les conteneurs
  enabled_log {
    category = "StorageRead"
  }
  enabled_log {
    category = "StorageWrite"
  }
  enabled_log {
    category = "StorageDelete"
  }

  # Métriques de transactions (nombre de requêtes, latence, erreurs)
  metric {
    category = "Transaction"
  }
}

# ---------------------------------------------------------------------
# 4. LOGS DE LA DATA FACTORY
#    Le plus utile pour un projet data : savoir quels pipelines ont
#    tourné, lesquels ont échoué, et pourquoi.
#    Tables dans le workspace : ADFPipelineRun, ADFActivityRun, ADFTriggerRun
# ---------------------------------------------------------------------
resource "azurerm_monitor_diagnostic_setting" "adf" {
  name                           = "diag-adf-to-law"
  target_resource_id             = azurerm_data_factory.adf.id
  log_analytics_workspace_id     = azurerm_log_analytics_workspace.law.id
  log_analytics_destination_type = "Dedicated" # une table par type de log, plus lisible

  enabled_log {
    category = "PipelineRuns"
  }
  enabled_log {
    category = "ActivityRuns"
  }
  enabled_log {
    category = "TriggerRuns"
  }

  metric {
    category = "AllMetrics"
  }
}

# ---------------------------------------------------------------------
# 5. APPLICATION INSIGHTS
#    Pour monitorer votre application Python elle-même : ses logs, ses
#    erreurs, ses appels à l'API Mock, leur durée...
#    Les données sont rangées dans le même workspace que le reste.
# ---------------------------------------------------------------------
resource "azurerm_application_insights" "appi" {
  name                = "appi-smart-energy-${random_string.name.result}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  workspace_id        = azurerm_log_analytics_workspace.law.id
  application_type    = "other" # "other" convient pour une appli Python

  tags = {
    user = var.student_id
  }
}

# La "chaîne de connexion" que l'application Python utilisera pour
# envoyer ses données. Afficher avec : terraform output -raw appi_connection_string
output "appi_connection_string" {
  value     = azurerm_application_insights.appi.connection_string
  sensitive = true
}
