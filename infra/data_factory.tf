# Crée une Data Factory
resource "azurerm_data_factory" "adf" {
  name                = "adf-${var.student_id}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

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
  name            = "ds-source-rest"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "RestResource"

  linked_service {
    name = azurerm_data_factory_linked_custom_service.source_rest.name
  }

  type_properties_json = jsonencode({
    relativeUrl = "api/v1/readings"
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
  name            = "ds-destination-json"
  data_factory_id = azurerm_data_factory.adf.id
  type            = "Json"

  linked_service {
    name = azurerm_data_factory_linked_custom_service.destination_blob.name
  }

  type_properties_json = jsonencode({
    location = {
      type      = "AzureBlobStorageLocation"
      container = "landing"
      folderPath = "api"
      fileName  = "readings.json"
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
      name      = "CopyReadings"
      type      = "Copy"
      dependsOn = []

      policy = {
        timeout                = "0.12:00:00"
        retry                  = 2
        retryIntervalInSeconds = 30
        secureInput            = true
        secureOutput           = true
      }

      userProperties = []

      inputs = [
        {
          referenceName = azurerm_data_factory_custom_dataset.source_rest.name
          type          = "DatasetReference"
        }
      ]

      outputs = [
        {
          referenceName = azurerm_data_factory_custom_dataset.destination_json.name
          type          = "DatasetReference"
        }
      ]

      typeProperties = {
        source = {
          type                = "RestSource"
          requestMethod       = "GET"
          httpRequestTimeout  = "00:01:40"
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
  ])
}