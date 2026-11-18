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

export const TEACHER_NAME = 'Arthur';
export const TAGLINE = 'Cours particuliers de mathématiques et de physique-chimie';

// Présentation : un paragraphe par ligne du tableau.
export const ABOUT_PARAGRAPHS = [
  '[À compléter] Présentez-vous en deux ou trois phrases : parcours, niveau enseigné, expérience.',
  '[À compléter] Votre façon de travailler : méthode, suivi, préparation aux contrôles et examens.',
  '[À compléter] Informations pratiques : zone de déplacement pour les cours à domicile, cours à distance, etc.',
];

// Mode d'emploi affiché sur la page d'accueil (titre + explication).
export const HOW_TO = [
  ['Recevoir une invitation', 'L\'accès au site se fait uniquement sur invitation. Je vous envoie un lien personnel : ouvrez-le, saisissez votre adresse e-mail et choisissez un mot de passe.'],
  ['Compléter votre profil', 'Indiquez le nom de l\'élève, vos coordonnées, l\'adresse (pour les cours à domicile) et la classe.'],
  ['Demander un cours', 'Dans « Réserver », cliquez sur un créneau disponible puis sur un autre plus bas le même jour pour allonger le cours. Choisissez ensuite le lieu (domicile ou à distance) et la matière.'],
  ['Attendre la confirmation', 'Votre demande apparaît « en attente » jusqu\'à ma validation, puis « cours programmé ». Vous pouvez retirer une demande tant qu\'elle n\'est pas validée.'],
  ['Suivre vos cours', 'Dans « Mes cours » : date, matière, prix, lien de visio pour les cours à distance, statut du paiement et notes de séance.'],
];
