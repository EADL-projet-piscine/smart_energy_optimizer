"""Authentification de l'API : comptes, jetons et périmètre des sites de l'appelant.

Connexion par e-mail et mot de passe (condensé argon2 en base), jeton JWT signé de
courte durée dans un cookie `HttpOnly`, contrôle sur chaque route que le site
demandé est dans le périmètre de l'utilisateur.
"""
