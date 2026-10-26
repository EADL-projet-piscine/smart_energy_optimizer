# =====================================================================
# TABLEAU DE BORD AZURE (partagé) défini en Terraform
# Construit à partir du JSON exporté depuis le portail : on garde le
# graphique Log Analytics épinglé, on retire les tuiles par défaut
# (Getting started, etc.) et on ajoute d'autres graphiques sur le même modèle.
#
# ⚠️ TEST : la création d'un tableau de bord partagé a échoué dans le portail.
# À tester avec -target ; s'il échoue en Terraform aussi, supprimer ce fichier.
# =====================================================================

locals {
  # Identifiant du workspace, en minuscules comme dans le JSON exporté
  law_id = lower(azurerm_log_analytics_workspace.law.id)

  # Les graphiques du tableau de bord. Pour chacun, on ne décrit que ce qui
  # change : position, titre, requête KQL, type de graphique et axes.
  # Le reste de la structure (identique pour tous) est assemblé plus bas.
  graphiques = {
    cpu = {
      position = { x = 0, y = 2, colSpan = 6, rowSpan = 4 }
      titre    = "CPU de la VM applicative (%)"
      requete  = "AzureMetrics\n| where ResourceProvider == \"MICROSOFT.COMPUTE\" and MetricName == \"Percentage CPU\"\n| summarize CPU_moyen = avg(Average) by bin(TimeGenerated, 5m)\n| render timechart"
      type     = "Line"
      part_id  = "6f1d3a52-1b7e-4c1a-9e0b-1a2b3c4d5e01"
      axes = {
        xAxis       = { name = "TimeGenerated", type = "datetime" }
        yAxis       = [{ name = "CPU_moyen", type = "real" }]
        splitBy     = []
        aggregation = "Average"
      }
    }

    stockage = {
      position = { x = 6, y = 2, colSpan = 6, rowSpan = 4 }
      titre    = "Opérations sur le compte de stockage"
      requete  = "AzureMetrics\n| where ResourceProvider == \"MICROSOFT.STORAGE\" and MetricName == \"Transactions\"\n| summarize Operations = sum(Total) by bin(TimeGenerated, 15m)\n| render columnchart"
      type     = "StackedColumn"
      part_id  = "6f1d3a52-1b7e-4c1a-9e0b-1a2b3c4d5e02"
      axes = {
        xAxis       = { name = "TimeGenerated", type = "datetime" }
        yAxis       = [{ name = "Operations", type = "real" }]
        splitBy     = []
        aggregation = "Sum"
      }
    }

    pipelines = {
      position = { x = 0, y = 6, colSpan = 6, rowSpan = 4 }
      titre    = "Pipelines Data Factory par statut"
      requete  = "union isfuzzy=true ADFPipelineRun\n| where Status in (\"Succeeded\", \"Failed\", \"Cancelled\")\n| summarize Executions = count() by Status\n| render piechart"
      type     = "Pie"
      part_id  = "6f1d3a52-1b7e-4c1a-9e0b-1a2b3c4d5e03"
      axes = {
        xAxis       = { name = "Status", type = "string" }
        yAxis       = [{ name = "Executions", type = "long" }]
        splitBy     = []
        aggregation = "Sum"
      }
    }
  }

  # Transforme chaque graphique ci-dessus en "part" au format Azure
  parts_graphiques = [
    for cle, g in local.graphiques : {
      position = g.position
      metadata = {
        type = "Extension/Microsoft_OperationsManagementSuite_Workspace/PartType/LogsDashboardPart"
        inputs = [
          { name = "resourceTypeMode", isOptional = true },
          { name = "ComponentId", isOptional = true },
          { name = "Scope", value = { resourceIds = [local.law_id] }, isOptional = true },
          { name = "PartId", value = g.part_id, isOptional = true },
          { name = "Version", value = "2.0", isOptional = true },
          { name = "TimeRange", value = "P1D", isOptional = true }, # 24 heures
          { name = "DashboardId", isOptional = true },
          { name = "DraftRequestParameters", isOptional = true },
          { name = "Query", value = g.requete, isOptional = true },
          { name = "ControlType", value = "FrameControlChart", isOptional = true },
          { name = "SpecificChart", value = g.type, isOptional = true },
          { name = "PartTitle", value = g.titre, isOptional = true },
          { name = "PartSubTitle", value = azurerm_log_analytics_workspace.law.name, isOptional = true },
          { name = "Dimensions", value = g.axes, isOptional = true },
          { name = "LegendOptions", value = { isEnabled = true, position = "Bottom" }, isOptional = true },
          { name = "IsQueryContainTimeRange", value = false, isOptional = true },
        ]
      }
    }
  ]

  # Une tuile de texte en haut, pour le titre
  part_titre = {
    position = { x = 0, y = 0, colSpan = 12, rowSpan = 2 }
    metadata = {
      type   = "Extension/HubsExtension/PartType/MarkdownPart"
      inputs = []
      settings = {
        content = {
          settings = {
            title    = "Smart Energy Optimizer"
            subtitle = "Monitoring de l'infrastructure"
            content  = "Données des dernières 24 heures, issues du workspace **${azurerm_log_analytics_workspace.law.name}**."
          }
        }
      }
    }
  }

  # Toutes les tuiles, numérotées "0", "1", "2"... comme Azure l'attend
  toutes_les_parts = concat([local.part_titre], local.parts_graphiques)
}

resource "azurerm_portal_dashboard" "dashboard" {
  name                = "dashboard-smart-energy"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location

  dashboard_properties = jsonencode({
    lenses = {
      "0" = {
        order = 0
        parts = { for i, p in local.toutes_les_parts : tostring(i) => p }
      }
    }
    metadata = {
      model = {}
    }
  })

  tags = {
    "hidden-title" = "Tableau de bord Smart Energy" # le nom affiché dans le portail
    user           = var.student_id
  }
}
