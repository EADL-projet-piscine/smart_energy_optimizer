# Crée une Data Factory
resource "azurerm_data_factory" "adf" {
  name                = "adf-${var.student_id}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  public_network_enabled = false

  identity {
    type = "SystemAssigned"
  }

  tags = {
    user = var.student_id
  }
}

# Crée un role pour autoriser Data Factory à écrire dans le conteneur
resource "azurerm_role_assignment" "adf_storage" {
  scope                = azurerm_storage_account.sa.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_data_factory.adf.identity[0].principal_id
}

# Crée un Linked Service REST
resource "azurerm_data_factory_linked_custom_service" "source_rest" {
  name            = "ls-source-rest"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "RestService"

  type_properties_json = jsonencode({
    url = "https://api-mock.charlieandre.fr/"
    enableServerCertificateValidation = true
    authenticationType = "Basic"
    userName = var.api_username
    password = {
      type = "SecureString"
      value = var.api_password
    }
  })
}

# Crée un Dataset pour la source REST
resource "azurerm_data_factory_custom_dataset" "source_rest" {
  name            = "dsSourceRest"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "RestResource"

  linked_service {
    name = azurerm_data_factory_linked_custom_service.source_rest.name
  }

  parameters = {
    site_id = "SITE001"
  }

  type_properties_json = jsonencode({
    relativeUrl = "@concat('api/v1/readings?site_id=', dataset().site_id, '&limit=1000')"
  })
}

# Crée un Linked Service pour stocker dans le compte de stockage
resource "azurerm_data_factory_linked_custom_service" "destination_blob" {
  name            = "ls-destination-blob"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "AzureBlobStorage"

  type_properties_json = jsonencode({
    serviceEndpoint = "https://${azurerm_storage_account.sa.name}.blob.core.windows.net/"
    accountKind     = "StorageV2"
    authenticationType = "ManagedIdentity"
  })

  depends_on = [
    azurerm_role_assignment.adf_storage
  ]
}

# Crée un Dataset pour stocker les données brutes
resource "azurerm_data_factory_custom_dataset" "destination_json" {
  name            = "dsDestinationJson"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "Json"

  linked_service {
    name = azurerm_data_factory_linked_custom_service.destination_blob.name
  }

  parameters = {
    site_id = "SITE001"
  }

  type_properties_json = jsonencode({
    location = {
      type      = "AzureBlobStorageLocation"
      container = "landing"
      folderPath = "api"
      fileName  = "@concat('readings', '_', dataset().site_id, '_', formatDateTime(utcNow(), 'yyyy-MM-dd_HH-mm-ss'), '.json')"
    }
    encodingName = "UTF-8"
  })
}

# Crée une pipeline qui copie les données brutes reçues de l'API vers le conteneur dans le compte de stockage
resource "azurerm_data_factory_pipeline" "copy_rest_to_blob" {
  name            = "pl-copy-rest-to-blob"
  data_factory_id = azurerm_data_factory.adf.id

  activities_json = jsonencode([
    {
      name      = "ForEachSite"
      type      = "ForEach"
      dependsOn = []

      typeProperties = {
        isSequential = true

        items = {
          value = "@createArray('SITE001', 'SITE002', 'SITE003', 'SITE004', 'SITE005', 'SITE006', 'SITE007')"
          type = "Expression"
        }

        activities = [
          {
            name = "CopySiteData"
            type = "Copy"
            dependsOn = []

            policy = {
              timeout = "0.12:00:00"
              retry = 2
              retryIntervalInSeconds = 30
              secureInput = true
              secureOutput = true
            }

            userProperties = []

            inputs = [
              {
                referenceName = azurerm_data_factory_custom_dataset.source_rest.name
                type          = "DatasetReference"

                parameters = {
                  site_id = {
                    value = "@item()"
                    type  = "Expression"
                  }
                }
              }
            ]

            outputs = [
              {
                referenceName = azurerm_data_factory_custom_dataset.destination_json.name
                type          = "DatasetReference"

                parameters = {
                  site_id = {
                    value = "@item()"
                    type  = "Expression"
                  }
                }
              }
            ]

            typeProperties = {
              source = {
                type               = "RestSource"
                requestMethod      = "GET"
                httpRequestTimeout = "00:01:40"
              }

              sink = {
                type = "JsonSink"

                storeSettings = {
                  type = "AzureBlobStorageWriteSettings"
                }

                formatSettings = {
                  type = "JsonWriteSettings"
                }
              }
            }
          }
        ]
      }
    }
  ])
}

# Crée un déclencheur qui déclenche la pipeline tous les jours à 00:00.
resource "azurerm_data_factory_trigger_schedule" "daily" {
  name            = "tr-copy-rest-daily"
  data_factory_id = azurerm_data_factory.adf.id
  pipeline_name   = azurerm_data_factory_pipeline.copy_rest_to_blob.name

  frequency = "Day"
  interval  = 1

  start_time = "2026-10-23T23:00:00Z"

  activated = true
}
