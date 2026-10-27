# =====================================================================
# REQUÊTES ENREGISTRÉES dans le workspace Log Analytics
# Les tableaux de bord (Grafana, Workbooks, tableaux de bord Azure) sont
# bloqués par l'école. À la place, on range nos requêtes de surveillance
# directement dans le workspace : elles se relancent en un clic depuis
# Journaux > Requêtes, dans la catégorie "Smart Energy".
# =====================================================================

locals {
  # Toutes nos requêtes, au même endroit.
  # Pour en ajouter une : copier un bloc, changer la clé, le titre et la requête.
  requetes = {
    cpu_vm = {
      titre   = "CPU de la VM applicative"
      requete = <<-KQL
        AzureMetrics
        | where ResourceProvider == "MICROSOFT.COMPUTE" and MetricName == "Percentage CPU"
        | summarize CPU_moyen = avg(Average) by bin(TimeGenerated, 5m)
        | render timechart
      KQL
    }

    credits_cpu_vm = {
      titre   = "Crédits CPU restants de la VM (série B)"
      requete = <<-KQL
        AzureMetrics
        | where ResourceProvider == "MICROSOFT.COMPUTE" and MetricName == "CPU Credits Remaining"
        | summarize Credits = avg(Average) by bin(TimeGenerated, 15m)
        | render timechart
      KQL
    }

    transactions_stockage = {
      titre   = "Activité du compte de stockage"
      requete = <<-KQL
        AzureMetrics
        | where ResourceProvider == "MICROSOFT.STORAGE" and MetricName == "Transactions"
        | summarize Operations = sum(Total) by bin(TimeGenerated, 15m)
        | render columnchart
      KQL
    }

    operations_fichiers = {
      titre   = "Opérations sur les fichiers (qui, quoi, résultat)"
      requete = <<-KQL
        union isfuzzy=true StorageBlobLogs
        | project TimeGenerated, OperationName, StatusText, CallerIpAddress, Uri
        | order by TimeGenerated desc
      KQL
    }

    pipelines_adf = {
      titre   = "Exécutions des pipelines Data Factory"
      requete = <<-KQL
        union isfuzzy=true ADFPipelineRun
        | where Status in ("Succeeded", "Failed", "Cancelled")
        | project TimeGenerated, PipelineName, Status, Start, End
        | order by TimeGenerated desc
      KQL
    }

    erreurs_adf = {
      titre   = "Erreurs des activités Data Factory"
      requete = <<-KQL
        union isfuzzy=true ADFActivityRun
        | where Status == "Failed"
        | project TimeGenerated, PipelineName, ActivityName, ErrorMessage
        | order by TimeGenerated desc
      KQL
    }
  }
}

# Une requête enregistrée est créée pour chaque élément de la liste ci-dessus
resource "azurerm_log_analytics_saved_search" "requetes" {
  for_each = local.requetes

  name                       = each.key
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id
  category                   = "Smart Energy" # le dossier où elles apparaissent
  display_name               = each.value.titre
  query                      = each.value.requete
}
