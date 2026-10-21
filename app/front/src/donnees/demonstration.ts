import { finaliserResume } from '../format'
import type { PointSerie, ResumeParc, Site } from '../modele'

const MESURE_PARC = [1850, 1780, 1720, 1680, 1710, 1840, 2100, 2420, 2680, 2790, 2860, 2890, 2840, 2780, 2820, 2880, 2847]
const PREVISION_PARC = [2847, 2890, 3050, 2920, 2600, 2280, 2020, 1880, 1780]
const MESURE_SITE2 = [520, 490, 460, 440, 450, 490, 560, 660, 740, 790, 820, 840, 810, 790, 800, 830, 812]
const PREVISION_SITE2 = [812, 900, 1040, 980, 860, 740, 640, 580, 540]

const POIDS_SITES = [680, 545, 470, 340]
const TOTAL_POIDS = 2035

function serie(mesures: Array<number | null>, previsions: Array<number | null>, heureDebutPrevision: number): PointSerie[] {
  return Array.from({ length: 25 }, (_, heure) => ({
    heure,
    mesureKw: mesures[heure] ?? null,
    previsionKw: previsions[heure - heureDebutPrevision] ?? null,
  }))
}

function repartir(reste: number): number[] {
  const planchers = POIDS_SITES.map((poids) => Math.floor((reste * poids) / TOTAL_POIDS))
  let manque = reste - planchers.reduce((somme, valeur) => somme + valeur, 0)
  const fractions = POIDS_SITES.map((poids, index) => ({
    index,
    fraction: (reste * poids) / TOTAL_POIDS - planchers[index],
  })).sort((a, b) => b.fraction - a.fraction)

  for (const fraction of fractions) {
    if (manque <= 0) break
    planchers[fraction.index] += 1
    manque -= 1
  }
  return planchers
}

function seriesAutresSites(): PointSerie[][] {
  const colonnes: number[][] = [[], [], [], []]
  const previsions: number[][] = [[], [], [], []]

  MESURE_PARC.forEach((valeur, index) => {
    repartir(valeur - MESURE_SITE2[index]).forEach((part, site) => colonnes[site].push(part))
  })
  PREVISION_PARC.forEach((valeur, index) => {
    repartir(valeur - PREVISION_SITE2[index]).forEach((part, site) => previsions[site].push(part))
  })

  return colonnes.map((mesures, index) => {
    const mesuresJour: Array<number | null> = Array.from({ length: 25 }, () => null)
    mesures.forEach((valeur, heure) => {
      mesuresJour[heure] = valeur
    })
    return serie(mesuresJour, previsions[index], MESURE_PARC.length - 1)
  })
}

function serieInterrompue(valeurs: number[]): PointSerie[] {
  const mesures: Array<number | null> = Array.from({ length: 25 }, () => null)
  valeurs.forEach((valeur, heure) => {
    mesures[heure] = valeur
  })
  return serie(mesures, [], 0)
}

export function resumeDemonstration(): ResumeParc {
  const [serie3, serie5, serie7, serie1] = seriesAutresSites()
  const heurePrevision = MESURE_PARC.length - 1

  const sites: Site[] = [
    {
      id: 'SITE002',
      nom: 'Usine de Charleville',
      type: 'Usine',
      releve: 'relevé horaire',
      actuelKw: 812,
      prevu2hKw: 1040,
      seuilKw: 930,
      mesuresRecues: 24,
      mesuresAttendues: 24,
      transmet: true,
      badge: null,
      serie: serie(
        Array.from({ length: 25 }, (_, heure) => MESURE_SITE2[heure] ?? null),
        PREVISION_SITE2,
        heurePrevision,
      ),
      heurePointe: null,
      commentaire: null,
      alertes: [
        {
          id: 'alerte-site002',
          severite: 'critique',
          titre: 'Nouvelle alerte critique',
          message:
            'SITE002 — dépassement de seuil prévu dans deux heures, 1 040 kW pour un seuil à 930 kW.',
        },
      ],
      recommandations: [
        {
          id: 'reco-site002-four',
          titre: 'Décaler le four de recuit après 21 h',
          detail: 'La pointe de 18 h repasse sous le seuil de 930 kW.',
          economie: '−180 €',
        },
        {
          id: 'reco-site002-ventilation',
          titre: 'Écrêter la ventilation des halls de 17 h à 19 h',
          detail: 'Effacement d’environ 90 kW sur le créneau critique.',
          economie: '−90 kW',
        },
      ],
    },
    {
      id: 'SITE003',
      nom: 'Data center de Reims',
      type: 'Data center',
      releve: 'relevé horaire',
      actuelKw: 680,
      prevu2hKw: null,
      seuilKw: 900,
      mesuresRecues: 24,
      mesuresAttendues: 24,
      transmet: true,
      badge: null,
      serie: serie3,
      heurePointe: null,
      commentaire: null,
      alertes: [],
      recommandations: [
        {
          id: 'reco-site003',
          titre: 'Reporter les lots de calcul non critiques après 20 h',
          detail: 'Le data center reste sous son seuil de 900 kW sur le créneau du soir.',
          economie: '−40 €',
        },
      ],
    },
    {
      id: 'SITE005',
      nom: 'Hôpital de Sedan',
      type: 'Hôpital',
      releve: 'relevé horaire',
      actuelKw: 545,
      prevu2hKw: null,
      seuilKw: 700,
      mesuresRecues: 24,
      mesuresAttendues: 24,
      transmet: true,
      badge: null,
      serie: serie5,
      heurePointe: null,
      commentaire: null,
      alertes: [],
      recommandations: [
        {
          id: 'reco-site005',
          titre: 'Lisser le préchauffage de l’eau sanitaire',
          detail: 'Avancer la charge du ballon hors du créneau 17 h–19 h.',
          economie: '−25 €',
        },
      ],
    },
    {
      id: 'SITE007',
      nom: 'Usine de Rethel',
      type: 'Usine',
      releve: 'relevé horaire',
      actuelKw: 470,
      prevu2hKw: null,
      seuilKw: 600,
      mesuresRecues: 24,
      mesuresAttendues: 24,
      transmet: true,
      badge: null,
      serie: serie7,
      heurePointe: null,
      commentaire: null,
      alertes: [],
      recommandations: [
        {
          id: 'reco-site007',
          titre: 'Enchaîner les presses après 19 h',
          detail: 'Évite d’additionner leur appel de puissance avec le reste du parc.',
          economie: '−60 kW',
        },
      ],
    },
    {
      id: 'SITE001',
      nom: 'Siège de Charleville',
      type: 'Bureau',
      releve: 'relevé horaire',
      actuelKw: 340,
      prevu2hKw: null,
      seuilKw: 450,
      mesuresRecues: 24,
      mesuresAttendues: 24,
      transmet: true,
      badge: null,
      serie: serie1,
      heurePointe: null,
      commentaire: null,
      alertes: [],
      recommandations: [
        {
          id: 'reco-site001',
          titre: 'Couper l’éclairage de façade dès 18 h',
          detail: 'Gain modeste, applicable dès ce soir sans toucher à l’exploitation.',
          economie: '−8 €',
        },
      ],
    },
    {
      id: 'SITE004',
      nom: 'Galerie de Charleville',
      type: 'Commerce',
      releve: 'relevé horaire',
      actuelKw: null,
      prevu2hKw: null,
      seuilKw: 400,
      mesuresRecues: 14,
      mesuresAttendues: 24,
      transmet: false,
      badge: null,
      serie: serieInterrompue([180, 170, 165, 160, 170, 190, 230, 280, 320, 340, 350, 330, 300, 260]),
      heurePointe: null,
      commentaire: null,
      alertes: [
        {
          id: 'alerte-site004',
          severite: 'moyenne',
          titre: 'Relevé interrompu',
          message: 'SITE004 — aucun relevé depuis plus de deux heures. Ce site est exclu du total du parc.',
        },
      ],
      recommandations: [
        {
          id: 'reco-site004',
          titre: 'Vérifier la passerelle de télérelève',
          detail: 'Le site ne remonte plus de mesure. Contrôler l’alimentation et le lien radio.',
          economie: null,
        },
      ],
    },
    {
      id: 'SITE006',
      nom: 'Agence de Rethel',
      type: 'Bureau',
      releve: 'relevé horaire',
      actuelKw: null,
      prevu2hKw: null,
      seuilKw: 220,
      mesuresRecues: 14,
      mesuresAttendues: 24,
      transmet: false,
      badge: null,
      serie: serieInterrompue([70, 65, 60, 58, 62, 80, 110, 140, 160, 170, 165, 150, 130, 110]),
      heurePointe: null,
      commentaire: null,
      alertes: [
        {
          id: 'alerte-site006',
          severite: 'moyenne',
          titre: 'Relevé interrompu',
          message: 'SITE006 — aucun relevé depuis plus de deux heures. Ce site est exclu du total du parc.',
        },
      ],
      recommandations: [
        {
          id: 'reco-site006',
          titre: 'Contrôler l’alimentation du compteur',
          detail: 'Le relevé est interrompu. Le site reste exclu du total tant que la chaîne de mesure est coupée.',
          economie: null,
        },
      ],
    },
  ]

  return finaliserResume({
    nombreSites: 7,
    derniereCollecte: '21:00',
    consommationKw: 2847,
    variationPct: 12,
    couverturePct: null,
    sitesTransmettant: 5,
    alertesTotal: 0,
    alertesCritiques: 0,
    alertesMoyennes: 0,
    coutJourEur: 4120,
    co2Tonnes: 1.8,
    sitesExclus: ['SITE004', 'SITE006'],
    seuilKw: 2900,
    pointeKw: null,
    heurePointe: null,
    serie: serie(
      Array.from({ length: 25 }, (_, heure) => MESURE_PARC[heure] ?? null),
      PREVISION_PARC,
      heurePrevision,
    ),
    commentaire: null,
    sites,
    source: 'demonstration',
  })
}
