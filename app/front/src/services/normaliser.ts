import { finaliserResume } from './format'
import type { Alerte, PointSerie, Recommandation, ResumeParc, Severite, Site } from './modele'

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

function lire(objet: Record<string, unknown>, cles: string[]): unknown {
  for (const cle of cles) {
    const valeur = objet[cle]
    if (valeur !== undefined && valeur !== null && valeur !== '') return valeur
  }
  return undefined
}

function nombre(valeur: unknown): number | null {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur
  if (typeof valeur === 'string' && valeur.trim() !== '') {
    const converti = Number(valeur.replace(/\s/g, '').replace(',', '.'))
    if (Number.isFinite(converti)) return converti
  }
  return null
}

function booleen(valeur: unknown): boolean | null {
  if (typeof valeur === 'boolean') return valeur
  if (typeof valeur === 'string') {
    const texte = valeur.toLowerCase()
    if (['true', '1', 'oui', 'yes', 'online'].includes(texte)) return true
    if (['false', '0', 'non', 'no', 'offline'].includes(texte)) return false
  }
  return null
}

function texte(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null
  const propre = valeur.trim()
  return propre.length > 0 ? propre : null
}

function heureDepuis(valeur: unknown): number | null {
  if (typeof valeur === 'number' && valeur >= 0 && valeur <= 24) return Math.round(valeur)
  if (typeof valeur === 'string') {
    const libelle = valeur.match(/^(\d{1,2})\s*h?$/)
    if (libelle) {
      const heure = Number(libelle[1])
      if (heure >= 0 && heure <= 24) return heure
    }
    const date = new Date(valeur)
    if (!Number.isNaN(date.getTime())) return date.getHours()
  }
  return null
}

function severite(valeur: unknown): Severite {
  const brut = String(valeur ?? '').toLowerCase()
  if (['critique', 'critical', 'high', 'haute', 'error', 'urgent', 'bloquant'].includes(brut)) return 'critique'
  if (['moyenne', 'medium', 'warning', 'warn', 'avertissement', 'moderee', 'modérée'].includes(brut)) {
    return 'moyenne'
  }
  return 'info'
}

function badgeDepuis(valeur: unknown): string | null {
  const libelle = texte(valeur)
  if (!libelle) return null
  const cle = libelle.toLowerCase().replaceAll(' ', '_')
  if (['forecast_exceedance', 'depassement', 'depassement_prevu', 'exceedance'].includes(cle)) {
    return 'Dépassement prévu'
  }
  if (['offline', 'stale', 'interrompu', 'releve_interrompu'].includes(cle)) return 'Relevé interrompu'
  if (['ok', 'stable', 'nominal'].includes(cle)) return null
  return libelle
}

function normaliserPoint(valeur: unknown, index: number): PointSerie | null {
  if (typeof valeur === 'number') {
    return { heure: index, mesureKw: valeur, previsionKw: null }
  }
  if (!estObjet(valeur)) return null
  const heure = heureDepuis(lire(valeur, ['hour', 'heure', 'h', 'timestamp', 'time', 'datetime'])) ?? index
  const mesure = nombre(
    lire(valeur, ['measured_kw', 'mesure_kw', 'consumption_kw', 'measured', 'mesure', 'value', 'kw']),
  )
  const prevision = nombre(
    lire(valeur, ['forecast_kw', 'prevision_kw', 'predicted_kw', 'forecast', 'prevision', 'prediction_kw']),
  )
  if (mesure === null && prevision === null) return null
  return { heure, mesureKw: mesure, previsionKw: prevision }
}

function normaliserSerie(valeur: unknown): PointSerie[] {
  if (!Array.isArray(valeur)) return []
  return valeur
    .map((point, index) => normaliserPoint(point, index))
    .filter((point): point is PointSerie => point !== null)
    .sort((a, b) => a.heure - b.heure)
}

function normaliserAlerte(valeur: unknown, index: number): Alerte | null {
  if (!estObjet(valeur)) return null
  const message = texte(lire(valeur, ['message', 'description', 'detail', 'texte', 'content']))
  const titre = texte(lire(valeur, ['title', 'titre', 'label', 'name'])) ?? 'Alerte'
  if (!message && titre === 'Alerte') return null
  return {
    id: texte(lire(valeur, ['id', 'alert_id', 'alerte_id'])) ?? `alerte-${index}`,
    severite: severite(lire(valeur, ['severity', 'severite', 'level', 'niveau', 'priority'])),
    titre,
    message: message ?? titre,
  }
}

function normaliserRecommandation(valeur: unknown, index: number): Recommandation | null {
  if (!estObjet(valeur)) return null
  const titre = texte(lire(valeur, ['title', 'titre', 'label', 'name', 'action']))
  const detail = texte(lire(valeur, ['description', 'detail', 'message', 'texte', 'content']))
  if (!titre && !detail) return null
  const economie = nombre(lire(valeur, ['estimated_savings_eur', 'economie_eur', 'savings_eur', 'gain_eur']))
  const gain = texte(lire(valeur, ['economie', 'gain', 'savings']))
  return {
    id: texte(lire(valeur, ['id', 'recommendation_id'])) ?? `reco-${index}`,
    titre: titre ?? 'Recommandation',
    detail: detail ?? '',
    economie: gain ?? (economie === null ? null : `−${new Intl.NumberFormat('fr-FR').format(economie)} €`),
  }
}

function normaliserSite(valeur: unknown, index: number): Site | null {
  if (!estObjet(valeur)) return null
  const id = texte(lire(valeur, ['id', 'site_id', 'code', 'site_code'])) ?? `SITE${String(index + 1).padStart(3, '0')}`
  const serie = normaliserSerie(
    lire(valeur, ['series', 'serie', 'hourly', 'points', 'timeline', 'history', 'mesures', 'measurements']),
  )
  const transmetExplicit = booleen(
    lire(valeur, ['transmitting', 'is_transmitting', 'transmet', 'online', 'active', 'is_online']),
  )
  const actuel = nombre(
    lire(valeur, [
      'current_kw',
      'current_consumption_kw',
      'consumption_kw',
      'actuel_kw',
      'puissance_kw',
      'power_kw',
    ]),
  )
  const alertes = tableau(lire(valeur, ['alerts', 'alertes']))
    .map((alerte, alerteIndex) => normaliserAlerte(alerte, alerteIndex))
    .filter((alerte): alerte is Alerte => alerte !== null)
  const recommandations = tableau(lire(valeur, ['recommendations', 'recommandations', 'actions']))
    .map((recommandation, recoIndex) => normaliserRecommandation(recommandation, recoIndex))
    .filter((recommandation): recommandation is Recommandation => recommandation !== null)

  return {
    id,
    nom: texte(lire(valeur, ['name', 'nom', 'site_name', 'label'])) ?? id,
    type: texte(lire(valeur, ['type', 'site_type', 'category', 'categorie', 'usage'])) ?? 'Site',
    releve: texte(lire(valeur, ['reading', 'releve', 'granularity', 'reading_interval'])) ?? 'relevé horaire',
    actuelKw: actuel,
    prevu2hKw: nombre(
      lire(valeur, ['forecast_2h_kw', 'forecast_plus_2h_kw', 'prevu_2h_kw', 'prevision_2h_kw', 'forecast_kw']),
    ),
    seuilKw: nombre(
      lire(valeur, ['threshold_kw', 'contractual_threshold_kw', 'seuil_kw', 'seuil_contractuel_kw', 'threshold']),
    ),
    mesuresRecues: nombre(lire(valeur, ['measures_received', 'mesures_recues', 'received', 'points_received'])),
    mesuresAttendues: nombre(
      lire(valeur, ['measures_expected', 'mesures_attendues', 'expected', 'points_expected']),
    ),
    transmet: transmetExplicit ?? (actuel !== null || serie.some((point) => point.mesureKw !== null)),
    badge: badgeDepuis(lire(valeur, ['badge', 'status', 'etat', 'state'])),
    serie,
    heurePointe: heureDepuis(lire(valeur, ['peak_hour', 'heure_pointe', 'forecast_peak_hour'])),
    commentaire: texte(lire(valeur, ['comment', 'commentaire', 'caption', 'summary'])),
    alertes,
    recommandations,
  }
}

function extraireSites(objet: Record<string, unknown>): Site[] {
  const brut = lire(objet, ['sites', 'site_summaries', 'siteSummaries', 'details'])
  if (Array.isArray(brut)) {
    return brut.map((site, index) => normaliserSite(site, index)).filter((site): site is Site => site !== null)
  }
  if (estObjet(brut)) {
    return Object.entries(brut)
      .map(([cle, valeur], index) => {
        if (!estObjet(valeur)) return normaliserSite({ id: cle, current_kw: valeur }, index)
        return normaliserSite({ id: cle, ...valeur }, index)
      })
      .filter((site): site is Site => site !== null)
  }
  return []
}

function attacherAlertesGlobales(sites: Site[], objet: Record<string, unknown>): Site[] {
  const brut = lire(objet, ['alerts', 'alertes'])
  if (!Array.isArray(brut)) return sites
  const copies = sites.map((site) => ({ ...site, alertes: [...site.alertes] }))
  brut.forEach((valeur, index) => {
    if (!estObjet(valeur)) return
    const alerte = normaliserAlerte(valeur, index)
    if (!alerte) return
    const siteId = texte(lire(valeur, ['site_id', 'siteId', 'site', 'code']))
    const site = copies.find((candidat) => candidat.id === siteId)
    if (!site) return
    if (site.alertes.some((existante) => existante.id === alerte.id)) return
    site.alertes.push(alerte)
  })
  return copies
}

function sommerSeries(sites: Site[]): PointSerie[] {
  const heures = new Set<number>()
  sites.forEach((site) => site.serie.forEach((point) => heures.add(point.heure)))
  return [...heures].sort((a, b) => a - b).map((heure) => {
    let mesure: number | null = null
    let prevision: number | null = null
    for (const site of sites) {
      if (!site.transmet) continue
      const point = site.serie.find((candidat) => candidat.heure === heure)
      if (!point) continue
      if (point.mesureKw !== null) mesure = (mesure ?? 0) + point.mesureKw
      if (point.previsionKw !== null) prevision = (prevision ?? 0) + point.previsionKw
    }
    return { heure, mesureKw: mesure, previsionKw: prevision }
  })
}

function normaliserObjet(objet: Record<string, unknown>): ResumeParc | null {
  const sites = attacherAlertesGlobales(extraireSites(objet), objet)
  const consommation = nombre(
    lire(objet, [
      'current_consumption_kw',
      'consommation_actuelle_kw',
      'consumption_kw',
      'total_consumption_kw',
      'current_kw',
    ]),
  )
  if (sites.length === 0 && consommation === null) return null

  const serie = normaliserSerie(
    lire(objet, ['series', 'serie', 'hourly', 'timeline', 'park_series', 'consumption_series']),
  )

  const collecte = lire(objet, [
    'last_collection',
    'last_reading_at',
    'derniere_collecte',
    'collected_at',
    'timestamp',
  ])

  const alertesCritiques = nombre(lire(objet, ['alerts_critical', 'critical_alerts', 'alertes_critiques']))
  const alertesMoyennes = nombre(lire(objet, ['alerts_medium', 'medium_alerts', 'alertes_moyennes']))
  const alertesTotal = nombre(lire(objet, ['alerts_open', 'open_alerts', 'alertes_en_cours', 'alerts_total']))

  const resume: ResumeParc = {
    nombreSites: nombre(lire(objet, ['sites_count', 'nombre_sites', 'total_sites'])) ?? sites.length,
    derniereCollecte: texte(collecte) ?? '',
    consommationKw: consommation,
    variationPct: nombre(
      lire(objet, [
        'consumption_delta_pct',
        'consumption_change_percent',
        'variation_horaire_pct',
        'delta_pct',
        'change_percent',
      ]),
    ),
    couverturePct: nombre(lire(objet, ['coverage_pct', 'coverage_percent', 'couverture_pct'])),
    sitesTransmettant:
      nombre(lire(objet, ['sites_transmitting', 'transmitting_sites', 'sites_transmettant'])) ?? 0,
    alertesTotal: alertesTotal ?? 0,
    alertesCritiques: alertesCritiques ?? 0,
    alertesMoyennes: alertesMoyennes ?? 0,
    coutJourEur: nombre(lire(objet, ['daily_cost_eur', 'cout_jour_eur', 'cost_eur', 'daily_cost'])),
    co2Tonnes: nombre(lire(objet, ['co2_equivalent_t', 'co2_tons', 'co2_t', 'co2_equivalent_tons'])),
    sitesExclus: extraireIdentifiants(lire(objet, ['excluded_sites', 'excluded_site_ids', 'sites_exclus'])),
    seuilKw: nombre(
      lire(objet, ['threshold_kw', 'contractual_threshold_kw', 'seuil_kw', 'seuil_contractuel_kw']),
    ),
    pointeKw: nombre(lire(objet, ['forecast_peak_kw', 'peak_kw', 'pointe_prevue_kw', 'pointe_kw'])),
    heurePointe: heureDepuis(lire(objet, ['forecast_peak_hour', 'peak_hour', 'heure_pointe'])),
    serie: serie.length > 0 ? serie : sommerSeries(sites),
    commentaire: texte(lire(objet, ['comment', 'commentaire', 'caption', 'insight'])),
    sites,
    source: 'api',
  }

  return finaliserResume(resume)
}

function tableau(valeur: unknown): unknown[] {
  return Array.isArray(valeur) ? valeur : []
}

function extraireIdentifiants(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return []
  return valeur
    .map((item) => {
      if (typeof item === 'string') return item
      if (estObjet(item)) return texte(lire(item, ['id', 'site_id', 'code']))
      return null
    })
    .filter((item): item is string => item !== null)
}

export function normaliserResume(corps: unknown): ResumeParc | null {
  if (Array.isArray(corps)) {
    const sites = corps.map((site, index) => normaliserSite(site, index)).filter((site): site is Site => site !== null)
    if (sites.length === 0) return null
    return normaliserObjet({ sites })
  }
  if (!estObjet(corps)) return null
  const direct = normaliserObjet(corps)
  if (direct) return direct
  for (const cle of ['data', 'result', 'summary', 'payload']) {
    const interne = corps[cle]
    if (estObjet(interne) || Array.isArray(interne)) {
      const resume = normaliserResume(interne)
      if (resume) return resume
    }
  }
  return null
}
