// =====================================================================
//  CONFIGURATION — seul fichier à modifier (avec la photo).
// =====================================================================

// --- Connexion à Supabase (Project Settings > Data API / API Keys).
// Valeurs publiques par conception : la sécurité est assurée par la base.
export const SUPABASE_URL = 'https://drnazlhdpcyqvwiyjwrg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_wXHfVoBSrMYp-v-PGN4FkQ_kRt8Psku';

export const SITE_TITLE = 'Cours particuliers';

// Plage horaire affichée dans le calendrier (heures entières).
export const DAY_START_HOUR = 8;   // première ligne : 08:00
export const DAY_END_HOUR = 21;    // dernière ligne : 20:30–21:00

// --- Page d'accueil ---------------------------------------------------
// Photo : déposer le fichier dans le dépôt GitHub sous ce nom exact
// (ou laisser '' pour ne pas afficher de photo).
export const PHOTO_URL = 'photo.jpg';

export const TEACHER_NAME = 'Arthur Bouvet';
export const TAGLINE = 'Professeur particulier';

// Présentation : un paragraphe par ligne du tableau.
export const ABOUT_PARAGRAPHS = [
  'Etudiant ingénieur de 23 ans en spécialisation Intelligence Artificielle à l\'Ecole Nationale Supérieure des Techniques Avancées (ENSTA) de Palaiseau.',
  'Cours particuliers de Mathématiques, Physique-Chimie et Informatique du collège aux études supérieures (Licence, IUT, BTS).',
  'A domicile ou en distanciel. Suivi possible en dehors des séances pour la correction d\'exercice.',
];

// Mode d'emploi affiché sur la page d'accueil (titre + explication).
export const HOW_TO = [
  ['Recevoir une invitation', 'L\'accès au site se fait uniquement sur invitation. Je vous envoie un lien personnel : ouvrez-le, saisissez votre adresse e-mail et choisissez un mot de passe.'],
  ['Compléter votre profil', 'Indiquez vos coordonnées.'],
  ['Demander un cours', 'Dans « Réserver », cliquez sur un créneau disponible puis sur un autre à la suite pour allonger le cours. Choisissez ensuite le lieu (domicile ou à distance) et la matière.'],
  ['Attendre la confirmation', 'Votre demande apparaît « en attente » jusqu\'à ma validation, puis « cours programmé ». Vous pouvez retirer une demande tant qu\'elle n\'est pas validée.'],
  ['Suivre vos cours', 'Dans « Mes cours » : tout le nécessaire pour assurer le suivi et retrouver les points abordés lors de chaque séance.'],
];
