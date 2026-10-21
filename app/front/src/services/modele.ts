export type Severite = 'critique' | 'moyenne' | 'info'

export type PointSerie = {
  heure: number
  mesureKw: number | null
  previsionKw: number | null
}

export type Alerte = {
  id: string
  severite: Severite
  titre: string
  message: string
}

export type Recommandation = {
  id: string
  titre: string
  detail: string
  economie: string | null
}

export type Site = {
  id: string
  nom: string
  type: string
  releve: string
  actuelKw: number | null
  prevu2hKw: number | null
  seuilKw: number | null
  mesuresRecues: number | null
  mesuresAttendues: number | null
  transmet: boolean
  badge: string | null
  serie: PointSerie[]
  heurePointe: number | null
  commentaire: string | null
  alertes: Alerte[]
  recommandations: Recommandation[]
}

export type ResumeParc = {
  nombreSites: number
  derniereCollecte: string
  consommationKw: number | null
  variationPct: number | null
  couverturePct: number | null
  sitesTransmettant: number
  alertesTotal: number
  alertesCritiques: number
  alertesMoyennes: number
  coutJourEur: number | null
  co2Tonnes: number | null
  sitesExclus: string[]
  seuilKw: number | null
  pointeKw: number | null
  heurePointe: number | null
  serie: PointSerie[]
  commentaire: string | null
  sites: Site[]
  source: 'api' | 'demonstration'
}
