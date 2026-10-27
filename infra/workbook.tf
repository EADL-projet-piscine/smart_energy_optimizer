# =====================================================================
# TABLEAU DE BORD : Azure Workbook (le "Grafana intégré" d'Azure)
# Il s'affiche dans le portail : workspace law-monitoring > Classeurs.
# Chaque graphique est une requête KQL, comme celles testées dans Journaux.
# =====================================================================

# Azure exige que le nom technique d'un workbook soit un identifiant
# unique (UUID). Le provider "random" le génère pour nous.
resource "random_uuid" "workbook" {}

resource "azurerm_application_insights_workbook" "dashboard" {
  name                = random_uuid.workbook.result
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  display_name        = "Tableau de bord Smart Energy" # le nom affiché dans le portail

  # Le workbook est rattaché au workspace : ses requêtes lisent ce cahier-là.
  # Azure exige ici l'identifiant en minuscules, d'où lower().
  source_id = lower(azurerm_log_analytics_workspace.law.id)

  # Le contenu du tableau de bord, décrit en JSON.
  # jsonencode() transforme cette description Terraform en JSON.
  data_json = jsonencode({
    version = "Notebook/1.0"
    items = [
      # --- Titre (type 1 = texte) ---
      {
        type = 1
        name = "titre"
        content = {
          json = "# Tableau de bord Smart Energy\nÉtat de l'infrastructure sur les dernières 24 heures."
        }
      },

      # --- Graphique 1 : CPU de la VM (type 3 = requête KQL) ---
      {
        type = 3
        name = "cpu-vm"
        content = {
          version       = "KqlItem/1.0"
          title         = "CPU de la VM applicative (%)"
          query         = <<-KQL
            AzureMetrics
            | where ResourceProvider == "MICROSOFT.COMPUTE" and MetricName == "Percentage CPU"
            | summarize CPU_moyen = avg(Average) by bin(TimeGenerated, 5m)
          KQL
          visualization = "timechart"
          size          = 0
          timeContext   = { durationMs = 86400000 } # 24 heures
          queryType     = 0
          resourceType  = "microsoft.operationalinsights/workspaces"
        }
        customWidth = "50"
      },

      # --- Graphique 2 : activité du compte de stockage ---
      {
        type = 3
        name = "transactions-stockage"
        content = {
          version       = "KqlItem/1.0"
          title         = "Opérations sur le compte de stockage"
          query         = <<-KQL
            AzureMetrics
            | where ResourceProvider == "MICROSOFT.STORAGE" and MetricName == "Transactions"
            | summarize Operations = sum(Total) by bin(TimeGenerated, 15m)
          KQL
          visualization = "barchart"
          size          = 0
          timeContext   = { durationMs = 86400000 }
          queryType     = 0
          resourceType  = "microsoft.operationalinsights/workspaces"
        }
        customWidth = "50"
      },

      # --- Graphique 3 : pipelines Data Factory par statut ---
      # "union isfuzzy=true" évite une erreur tant qu'aucun pipeline n'a tourné
      # (la table ADFPipelineRun n'existe pas encore dans ce cas).
      {
        type = 3
        name = "pipelines-adf"
        content = {
          version       = "KqlItem/1.0"
          title         = "Exécutions de pipelines Data Factory par statut"
          query         = <<-KQL
            union isfuzzy=true ADFPipelineRun
            | where Status in ("Succeeded", "Failed", "Cancelled")
            | summarize Executions = count() by Status
          KQL
          visualization = "piechart"
          size          = 0
          timeContext   = { durationMs = 86400000 }
          queryType     = 0
          resourceType  = "microsoft.operationalinsights/workspaces"
        }
        customWidth = "50"
      },

      # --- Graphique 4 : qui fait quoi sur le stockage ---
      {
        type = 3
        name = "operations-blob"
        content = {
          version       = "KqlItem/1.0"
          title         = "Types d'opérations sur les fichiers"
          query         = <<-KQL
            union isfuzzy=true StorageBlobLogs
            | summarize Nombre = count() by OperationName, StatusText
            | order by Nombre desc
          KQL
          visualization = "table"
          size          = 0
          timeContext   = { durationMs = 86400000 }
          queryType     = 0
          resourceType  = "microsoft.operationalinsights/workspaces"
        }
        customWidth = "50"
      }
    ]
    fallbackResourceIds = [lower(azurerm_log_analytics_workspace.law.id)]
  })

  tags = {
    user = var.student_id
  }
}
