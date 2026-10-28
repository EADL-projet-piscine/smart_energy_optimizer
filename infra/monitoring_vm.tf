# =====================================================================
# INSTALLATION AUTOMATIQUE de Prometheus + Grafana sur applicatif-vm
#
# Terraform demande à Azure d'exécuter un script DANS la VM (extension
# "Custom Script"). Le script installe Docker et lance la stack décrite
# dans le dossier monitoring-stack (à la racine du projet).
#
# Pourquoi pas le champ custom_data de la VM ? Parce que le modifier
# obligerait Terraform à DÉTRUIRE et RECRÉER la VM. L'extension, elle,
# s'ajoute à la VM existante sans la toucher.
#
# Si un fichier de monitoring-stack change, Terraform le voit et relance
# le script au prochain apply : la stack est mise à jour toute seule.
# =====================================================================

locals {
  # Chemin du dossier monitoring-stack, à côté du dossier infra
  stack_dir = "${path.module}/../monitoring-stack"

  # Le contenu du fichier .env, fabriqué à partir des variables Terraform
  stack_env = <<-EOT
    GRAFANA_ADMIN_PASSWORD=${var.grafana_admin_password}
    AZURE_SUBSCRIPTION_ID=${var.subscription_id}
  EOT

  # IMPORTANT sous Windows : les fichiers y ont des fins de ligne "CRLF"
  # (un caractère invisible \r en plus à chaque ligne). Linux ne les
  # comprend pas : le script planterait et le mot de passe aurait un \r
  # à la fin. replace(..., "\r", "") retire ce caractère partout.

  # Le script final, avec les fichiers insérés dedans (encodés en base64)
  install_script = replace(templatefile("${path.module}/scripts/install_monitoring.sh.tftpl", {
    admin_username     = var.admin_username
    docker_version     = var.docker_version
    docker_compose_b64 = base64encode(replace(file("${local.stack_dir}/docker-compose.yml"), "\r", ""))
    prometheus_b64     = base64encode(replace(file("${local.stack_dir}/prometheus/prometheus.yml"), "\r", ""))
    datasources_b64    = base64encode(replace(file("${local.stack_dir}/grafana/provisioning/datasources/datasources.yml"), "\r", ""))
    env_b64            = base64encode(replace(local.stack_env, "\r", ""))

    # Les tableaux de bord Grafana
    dashboards_conf_b64 = base64encode(replace(file("${local.stack_dir}/grafana/provisioning/dashboards/dashboards.yml"), "\r", ""))
    # Le tableau de bord Azure doit connaître l'identifiant du workspace :
    # Terraform remplace le repère __WORKSPACE_ID__ par la vraie valeur.
    dashboard_azure_b64 = base64encode(replace(replace(
      file("${local.stack_dir}/grafana/dashboards/smart-energy-azure.json"),
      "__WORKSPACE_ID__", azurerm_log_analytics_workspace.law.id
    ), "\r", ""))
  }), "\r", "")
}

resource "azurerm_virtual_machine_extension" "monitoring_stack" {
  name                       = "install-monitoring-stack"
  virtual_machine_id         = azurerm_linux_virtual_machine.applicatif-vm.id
  publisher                  = "Microsoft.Azure.Extensions"
  type                       = "CustomScript"
  type_handler_version       = "2.1"
  auto_upgrade_minor_version = true

  # "protected" : le script (qui contient le mot de passe Grafana) est
  # chiffré par Azure et n'apparaît pas en clair dans le portail.
  protected_settings = jsonencode({
    script = base64encode(local.install_script)
  })

  # Il faut que la VM ait le droit de lire Azure avant que Grafana démarre
  depends_on = [azurerm_role_assignment.vm_lecture_monitoring]

  tags = {
    user = var.student_id
  }
}
