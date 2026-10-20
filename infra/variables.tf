variable "student_id" {
    type        = string
    description = "L'identifiant de l'élève, par exemple egrondin2023"
}

variable "subscription_id" {
    type = string
    description = "L'ID de l'abonnement"
}

variable "vnet_address_space" {
    type = string
    description = "L'espace d'adressage du réseau virtuel"
}