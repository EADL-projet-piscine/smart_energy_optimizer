variable "student_id" {
  type        = string
  description = "L'identifiant de l'élève, par exemple egrondin2023"
}

variable "subscription_id" {
  type        = string
  description = "L'ID de l'abonnement"
}

variable "address_index" {
  type        = string
  description = "L'index de l'espace d'addressage, défini par ordre alphabétique"
}

variable "sa_name" {
  type        = string
  description = "La nom du compte de stockage (storage account). Le nom doit contenir seulement des lettres minuscules et des chiffres."
}

variable "admin_username" {
  type        = string
  description = "Le nom d'utilisateur du compte admin sur la VM applicatif"
}

variable "ip" {
  type        = string
  description = "L'adresse IP publique de votre poste, pour pouvoir accéder à la VM"
}

variable "api_username" {
  type        = string
  description = "Le nom d'utilisateur pour se connecter à l'API Mock"
}

variable "api_password" {
  type        = string
  description = "Le mot de passe pour se connecter à l'API Mock"
}

variable "grafana_admin_password" {
  description = "Mot de passe du compte admin de Grafana - utile pour l'initialisation de Grafana"
  type        = string
  sensitive   = true # Terraform ne l'affichera jamais dans le terminal
}

variable "docker_version" {
  description = "Version de Docker Engine à installer sur la VM (ex : 28.5.1)"
  type        = string
  default     = "29.0.1"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.docker_version))
    error_message = "La version doit avoir la forme X.Y.Z, par exemple 28.5.1 (sans le \"v\")."
  }
}
