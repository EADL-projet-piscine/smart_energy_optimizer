import type { PointSerie, ResumeParc, Site } from './modele'

const NOMBRES = [
  'Aucun site',
  'Un site',
  'Deux sites',
  'Trois sites',
  'Quatre sites',
  'Cinq sites',
  'Six sites',
  'Sept sites',
  'Huit sites',
  'Neuf sites',
  'Dix sites',
]

export function formaterNombre(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valeur)
}

export function formaterKw(valeur: number | null): string {
  if (valeur === null) return '—'
  return formaterNombre(valeur)
}

export function libelleSites(nombre: number): string {
  return NOMBRES[nombre] ?? `${nombre} sites`
}

export function formaterCollecte(valeur: string): string {
  if (/^\d{1,2}:\d{2}$/.test(valeur)) return valeur
  const date = new Date(valeur)
  if (Number.isNaN(date.getTime())) return valeur
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function libelleAlertes(critiques: number, moyennes: number): string {
  const critique = `${critiques} critique${critiques > 1 ? 's' : ''}`
  const moyenne = `${moyennes} moyenne${moyennes > 1 ? 's' : ''}`
  return `${critique} · ${moyenne}`
}

export function derniereHeureMesuree(serie: PointSerie[]): number | null {
  for (let index = serie.length - 1; index >= 0; index -= 1) {
    if (serie[index].mesureKw !== null) return serie[index].heure
  }
  return null
}

export function pointePrevue(
  serie: PointSerie[],
  apresHeure?: number,
): { heure: number; valeur: number } | null {
  let meilleure: { heure: number; valeur: number } | null = null
  for (const point of serie) {
    if (point.previsionKw === null) continue
    if (apresHeure !== undefined && point.heure <= apresHeure) continue
    if (!meilleure || point.previsionKw > meilleure.valeur) {
      meilleure = { heure: point.heure, valeur: point.previsionKw }
    }
  }
  if (meilleure || apresHeure === undefined) return meilleure
  return pointePrevue(serie)
}

export function previsionDans(serie: PointSerie[], heure: number): number | null {
  return serie.find((point) => point.heure === heure)?.previsionKw ?? null
}

function phrasePointe(seuil: number, pointe: number, heure: number, sujet: 'parc' | 'site'): string {
  if (pointe > seuil && sujet === 'parc') {
    return `Le seuil contractuel serait dépassé vers ${heure} h avec une pointe prévue à ${formaterNombre(pointe)} kW.`
  }
  if (pointe > seuil) {
    return `Le seuil contractuel de ${formaterNombre(seuil)} kW serait franchi vers ${heure} h, avec une pointe prévue à ${formaterNombre(pointe)} kW.`
  }
  if (sujet === 'parc') {
    return `Le seuil contractuel de ${formaterNombre(seuil)} kW reste respecté. Pointe prévue à ${formaterNombre(pointe)} kW vers ${heure} h.`
  }
  return `La consommation prévue reste sous le seuil de ${formaterNombre(seuil)} kW, avec une pointe à ${formaterNombre(pointe)} kW vers ${heure} h.`
}

export function completerSite(site: Site): Site {
  const heureMesure = derniereHeureMesuree(site.serie)
  const pointe = pointePrevue(site.serie, heureMesure ?? undefined)
  const prevu2h =
    site.prevu2hKw ?? (heureMesure === null ? null : previsionDans(site.serie, heureMesure + 2))
  const heurePointe = site.heurePointe ?? pointe?.heure ?? null
  const valeurPointe = pointe?.valeur ?? null

  let badge = site.badge
  if (!badge) {
    if (!site.transmet) badge = 'Relevé interrompu'
    else if (site.seuilKw !== null && prevu2h !== null && prevu2h > site.seuilKw) badge = 'Dépassement prévu'
    else if (site.alertes.some((alerte) => alerte.severite === 'critique')) badge = 'Alerte critique'
  }

  let commentaire = site.commentaire
  if (!commentaire) {
    if (!site.transmet) {
      commentaire = `Aucun relevé exploitable depuis plus de deux heures. ${site.id} est exclu du total du parc.`
    } else if (site.seuilKw !== null && valeurPointe !== null && heurePointe !== null) {
      commentaire = phrasePointe(site.seuilKw, valeurPointe, heurePointe, 'site')
    }
  }

  return {
    ...site,
    prevu2hKw: prevu2h,
    heurePointe,
    badge: badge ?? null,
    commentaire: commentaire ?? null,
  }
}

export function finaliserResume(resume: ResumeParc): ResumeParc {
  const sites = resume.sites.map(completerSite)
  const alertes = sites.flatMap((site) => site.alertes)
  const exclus =
    resume.sitesExclus.length > 0 ? resume.sitesExclus : sites.filter((site) => !site.transmet).map((site) => site.id)
  const transmettant = sites.length > 0 ? sites.filter((site) => site.transmet).length : resume.sitesTransmettant
  const nombreSites = sites.length > 0 ? sites.length : resume.nombreSites
  const pointe = pointePrevue(resume.serie, derniereHeureMesuree(resume.serie) ?? undefined)
  const heurePointe = resume.heurePointe ?? pointe?.heure ?? null
  const pointeKw = resume.pointeKw ?? pointe?.valeur ?? null
  const couverture =
    resume.couverturePct ?? (nombreSites > 0 ? Math.round((transmettant / nombreSites) * 100) : null)

  const contributeur = sites.find((site) => site.alertes.some((alerte) => alerte.severite === 'critique'))
  let commentaire = resume.commentaire
  if (!commentaire && resume.seuilKw !== null && pointeKw !== null && heurePointe !== null) {
    commentaire = phrasePointe(resume.seuilKw, pointeKw, heurePointe, 'parc')
    if (pointeKw > resume.seuilKw && contributeur) {
      commentaire += ` Une alerte a été levée sur ${contributeur.id}, principal contributeur.`
    }
  }

  return {
    ...resume,
    sites,
    sitesExclus: exclus,
    sitesTransmettant: transmettant,
    nombreSites,
    couverturePct: couverture,
    heurePointe,
    pointeKw,
    commentaire,
    alertesTotal: alertes.length > 0 ? alertes.length : resume.alertesTotal,
    alertesCritiques:
      alertes.length > 0
        ? alertes.filter((alerte) => alerte.severite === 'critique').length
        : resume.alertesCritiques,
    alertesMoyennes:
      alertes.length > 0
        ? alertes.filter((alerte) => alerte.severite === 'moyenne').length
        : resume.alertesMoyennes,
  }
}
