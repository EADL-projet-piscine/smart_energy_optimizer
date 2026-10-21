variable "student_id" {
    type        = string
    description = "L'identifiant de l'élève, par exemple egrondin2023"
}

variable "subscription_id" {
    type = string
    description = "L'ID de l'abonnement"
}

variable "address_index" {
    type = string
    description = "L'index de l'espace d'addressage, défini par ordre alphabétique"
}

variable "sa_name" {
    type = string
    description = "La nom du compte de stockage (storage account). Le nom doit contenir seulement des lettres minuscules et des chiffres."
}

variable "admin_username" {
    type = string
    description = "Le nom d'utilisateur du compte admin sur la VM applicatif"
}

variable "ip" {
    type = string
    description = "L'adresse IP publique de votre poste, pour pouvoir accéder à la VM"
}